/**
 * app/api/bridge/attestation/route.ts
 * Server-side proxy ke Circle Iris V2 API — bypass CORS di browser.
 *
 * Strategi dual-endpoint:
 *   1. /v2/messages/{sourceDomain}?transactionHash={txHash}  ← preferred
 *   2. /v2/attestations/{messageHash}                        ← fallback
 *
 * Set IRIS_API_URL di env untuk override jika domain diblokir di hosting.
 * Default: https://iris-api-sandbox.circle.com (testnet)
 *
 * Diagnosa: GET /api/bridge/attestation?test=1
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Override via IRIS_API_URL env jika Vercel tidak bisa reach domain default
const IRIS = (process.env.IRIS_API_URL ?? 'https://iris-api-sandbox.circle.com').replace(/\/$/, '')

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/** Single fetch ke Iris dengan timeout 10s (per Circle recommendation) */
async function irisGet(url: string): Promise<Response> {
  return fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
}

/** Fetch dengan retry + exponential backoff: 2s → 2.6s → ... max 15s */
async function fetchWithRetry(url: string, maxRetries = 4): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await irisGet(url)
      // 404 = belum ada di Iris (normal) — bukan error fatal
      if (res.ok || res.status === 404) return res
      // 5xx → retry
      if (res.status >= 500 && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, Math.min(2000 * Math.pow(1.3, i), 15_000)))
        continue
      }
      return res
    } catch (e) {
      lastErr = e
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, Math.min(2000 * Math.pow(1.3, i), 15_000)))
      }
    }
  }
  throw lastErr ?? new Error('fetch failed after retries')
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  // ── Test endpoint: ?test=1 — diagnosa koneksi ke Iris dari Vercel ─────
  // Akses: https://nexlink-xi.vercel.app/api/bridge/attestation?test=1
  if (searchParams.get('test') === '1') {
    try {
      const res = await irisGet(`${IRIS}/v2/attestations/0x${'0'.repeat(64)}`)
      return json({ ok: true, irisUrl: IRIS, httpStatus: res.status, reachable: true })
    } catch (e: any) {
      return json({ ok: false, irisUrl: IRIS, error: e?.message, reachable: false }, 502)
    }
  }

  const messageHash  = searchParams.get('messageHash')
  const sourceDomain = searchParams.get('sourceDomain')
  const txHash       = searchParams.get('txHash')

  if (!messageHash || !/^0x[a-fA-F0-9]{64}$/.test(messageHash)) {
    return json({ ok: false, error: 'messageHash tidak valid (harus 0x + 64 hex chars)' }, 400)
  }

  // ── Strategy 1: /v2/messages/{domain}?transactionHash={txHash} ────────
  // Lebih reliable — tidak butuh messageHash yang tepat
  if (sourceDomain && txHash) {
    try {
      const url = `${IRIS}/v2/messages/${sourceDomain}?transactionHash=${txHash}`
      const res = await fetchWithRetry(url)

      if (res.ok) {
        const data = await res.json() as any
        const msg  = Array.isArray(data?.messages) ? data.messages[0] : null
        if (msg) {
          const status      = msg.status ?? 'pending_confirmations'
          const attestation = msg.attestation && msg.attestation !== 'PENDING'
            ? msg.attestation as string : null
          if (status === 'complete' && attestation) {
            return json({ ok: true, status: 'complete', attestation })
          }
          return json({ ok: true, status: 'pending_confirmations', attestation: null })
        }
      } else if (res.status !== 404) {
        console.warn(`[attestation] /v2/messages HTTP ${res.status}`)
      }
    } catch (e: any) {
      console.error('[attestation] Iris V2 fetch failed:', e?.message)
      // Jangan stop — coba strategy 2
    }
  }

  // ── Strategy 2: /v2/attestations/{messageHash} ────────────────────────
  try {
    const url = `${IRIS}/v2/attestations/${messageHash}`
    const res = await fetchWithRetry(url)

    if (res.ok) {
      const data = await res.json() as any
      const status      = data?.status ?? 'pending_confirmations'
      const attestation = data?.attestation && data.attestation !== 'PENDING'
        ? data.attestation as string : null
      if (status === 'complete' && attestation) {
        return json({ ok: true, status: 'complete', attestation })
      }
      return json({ ok: true, status: 'pending_confirmations', attestation: null })
    }

    if (res.status === 404) {
      return json({ ok: true, status: 'pending_confirmations', attestation: null })
    }

    const errText = await res.text().catch(() => '')
    console.error(`[attestation] /v2/attestations HTTP ${res.status}:`, errText.slice(0, 200))
    return json({ ok: true, status: 'pending_confirmations', attestation: null,
      hint: `Iris HTTP ${res.status} — polling dilanjutkan` })
  } catch (e: any) {
    console.error('[attestation] Iris V2 fetch failed:', e?.message)
    return json({ ok: true, status: 'pending_confirmations', attestation: null,
      hint: `Network error: ${e?.message} — polling dilanjutkan` })
  }
}
