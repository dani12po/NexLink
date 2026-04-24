/**
 * app/api/bridge/attestation/route.ts
 * Server-side proxy ke Circle Iris V2 API — bypass CORS di browser.
 *
 * Strategi dual-endpoint:
 *   1. /v2/messages/{sourceDomain}?transactionHash={txHash}  ← preferred (lebih reliable)
 *   2. /v2/attestations/{messageHash}                        ← fallback jika (1) gagal
 *
 * Exponential backoff per-request: 2s → 2.6s → 3.4s → ... max 15s
 * AbortSignal.timeout(15_000) per fetch agar tidak hang di Vercel serverless.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IRIS = 'https://iris-api-sandbox.circle.com'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/** Fetch dengan retry + exponential backoff. Throw jika semua retry habis. */
async function fetchWithRetry(
  url: string,
  maxRetries = 4,
  baseDelayMs = 2000,
): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        // Timeout per-request 15 detik — cegah hang di Vercel
        signal: AbortSignal.timeout(15_000),
        // Jangan cache di edge/CDN
        cache: 'no-store',
      })
      // 404 = message belum ada di Iris (normal saat baru burn) — bukan error fatal
      if (res.ok || res.status === 404) return res
      // 5xx → retry
      if (res.status >= 500 && i < maxRetries - 1) {
        const delay = Math.min(baseDelayMs * Math.pow(1.3, i), 15_000)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      return res // 4xx selain 404 → kembalikan apa adanya
    } catch (e) {
      lastErr = e
      if (i < maxRetries - 1) {
        const delay = Math.min(baseDelayMs * Math.pow(1.3, i), 15_000)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr ?? new Error('fetch failed after retries')
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const messageHash  = searchParams.get('messageHash')
  const sourceDomain = searchParams.get('sourceDomain')
  const txHash       = searchParams.get('txHash')

  if (!messageHash || !/^0x[a-fA-F0-9]{64}$/.test(messageHash)) {
    return json({ ok: false, error: 'messageHash tidak valid (harus 0x + 64 hex chars)' }, 400)
  }

  // ── Strategy 1: /v2/messages/{domain}?transactionHash={txHash} ────────
  // Endpoint ini lebih reliable karena tidak perlu messageHash yang tepat
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
            ? msg.attestation as string
            : null

          if (status === 'complete' && attestation) {
            return json({ ok: true, status: 'complete', attestation })
          }
          // Masih pending — return pending agar client lanjut polling
          return json({ ok: true, status: 'pending_confirmations', attestation: null })
        }
      } else if (res.status === 404) {
        // Belum ada di Iris — normal, lanjut ke strategy 2
      } else {
        console.warn(`[attestation] /v2/messages HTTP ${res.status}`)
      }
    } catch (e: any) {
      console.error('[attestation] /v2/messages fetch failed:', e?.message)
      // Jangan return error — coba strategy 2
    }
  }

  // ── Strategy 2: /v2/attestations/{messageHash} ────────────────────────
  // Fallback: pakai messageHash langsung
  try {
    const url = `${IRIS}/v2/attestations/${messageHash}`
    const res = await fetchWithRetry(url)

    if (res.ok) {
      const data = await res.json() as any
      // Response: { status: "complete"|"pending_confirmations", attestation: "0x..." }
      const status      = data?.status ?? 'pending_confirmations'
      const attestation = data?.attestation && data.attestation !== 'PENDING'
        ? data.attestation as string
        : null

      if (status === 'complete' && attestation) {
        return json({ ok: true, status: 'complete', attestation })
      }
      return json({ ok: true, status: 'pending_confirmations', attestation: null })
    }

    if (res.status === 404) {
      // Belum ada — normal
      return json({ ok: true, status: 'pending_confirmations', attestation: null })
    }

    const errText = await res.text().catch(() => '')
    console.error(`[attestation] /v2/attestations HTTP ${res.status}:`, errText.slice(0, 200))
    // Return pending (bukan error) agar client tidak stop polling
    return json({
      ok: true,
      status: 'pending_confirmations',
      attestation: null,
      hint: `Iris HTTP ${res.status} — polling dilanjutkan`,
    })
  } catch (e: any) {
    console.error('[attestation] /v2/attestations fetch failed:', e?.message)
    // Return pending agar client tidak stop polling karena network blip
    return json({
      ok: true,
      status: 'pending_confirmations',
      attestation: null,
      hint: `Network error: ${e?.message} — polling dilanjutkan`,
    })
  }
}
