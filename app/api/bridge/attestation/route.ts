/**
 * app/api/bridge/attestation/route.ts
 *
 * CATATAN PENTING: Endpoint ini hanya sebagai FALLBACK.
 * Primary attestation polling dilakukan dari browser (client-side) di hooks/useBridge.ts
 * karena Vercel serverless IP diblokir Circle Iris (403 "Host not in allowlist").
 *
 * Browser tidak kena IP restriction — Iris support CORS untuk browser.
 *
 * Diagnosa: GET /api/bridge/attestation?test=1
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IRIS = (process.env.IRIS_API_URL ?? 'https://iris-api-sandbox.circle.com').replace(/\/$/, '')

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

async function irisGet(url: string): Promise<Response> {
  return fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await irisGet(url)
      if (res.ok || res.status === 404) return res
      if (res.status >= 500 && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(1.3, i)))
        continue
      }
      return res
    } catch (e) {
      lastErr = e
      if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 2000 * Math.pow(1.3, i)))
    }
  }
  throw lastErr ?? new Error('fetch failed')
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  // ── Endpoint diagnostik ────────────────────────────────────────────────
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
    return json({ ok: false, error: 'messageHash tidak valid' }, 400)
  }

  // ── Strategy 1: /v2/messages/{domain}?transactionHash={txHash} ────────
  if (sourceDomain && txHash) {
    try {
      const res = await fetchWithRetry(`${IRIS}/v2/messages/${sourceDomain}?transactionHash=${txHash}`)
      if (res.ok) {
        const data = await res.json() as any
        const msg  = Array.isArray(data?.messages) ? data.messages[0] : null
        if (msg) {
          const att = msg.attestation && msg.attestation !== 'PENDING' ? msg.attestation as string : null
          if (msg.status === 'complete' && att) return json({ ok: true, status: 'complete', attestation: att })
          return json({ ok: true, status: 'pending', attestation: null })
        }
      }
    } catch (e: any) {
      console.error('[attestation] /v2/messages failed:', e?.message)
    }
  }

  // ── Strategy 2: /v2/attestations/{messageHash} ────────────────────────
  try {
    const res = await fetchWithRetry(`${IRIS}/v2/attestations/${messageHash}`)
    if (res.ok) {
      const data = await res.json() as any
      const att  = data?.attestation && data.attestation !== 'PENDING' ? data.attestation as string : null
      if (data?.status === 'complete' && att) return json({ ok: true, status: 'complete', attestation: att })
      return json({ ok: true, status: 'pending', attestation: null })
    }
    if (res.status === 404) return json({ ok: true, status: 'pending', attestation: null })
    console.error(`[attestation] HTTP ${res.status}`)
  } catch (e: any) {
    console.error('[attestation] fetch failed:', e?.message)
  }

  // Selalu return pending (bukan error) agar client bisa retry
  return json({ ok: true, status: 'pending', attestation: null })
}
