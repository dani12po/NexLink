/**
 * app/api/bridge/attestation/route.ts
 * Proxy ke Circle Iris API V2 untuk fetch attestation.
 * Retry 3x dengan exponential backoff jika gagal.
 * Ref: https://developers.circle.com/cctp
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IRIS = 'https://iris-api-sandbox.circle.com'
const MAX_RETRIES = 3

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok || res.status === 404) return res // 404 = pending, bukan error
      if (i < retries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)))
      }
    } catch (e: any) {
      if (i === retries - 1) throw e
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)))
    }
  }
  throw new Error(`Failed after ${retries} retries`)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const messageHash  = searchParams.get('messageHash')
  const sourceDomain = searchParams.get('sourceDomain')
  const txHash       = searchParams.get('txHash')

  if (!messageHash || !/^0x[a-fA-F0-9]{64}$/.test(messageHash)) {
    return json({ ok: false, error: 'messageHash tidak valid' }, 400)
  }

  let status = 'pending'
  let attestation: string | null = null
  const errors: string[] = []

  // ── Try V2 endpoint (requires sourceDomain + txHash) ──────────────────
  // HANYA V2 — V1 attestation ditolak oleh CCTP V2 MessageTransmitter
  if (sourceDomain && txHash) {
    try {
      const url = `${IRIS}/v2/messages/${sourceDomain}?transactionHash=${txHash}`
      const res = await fetchWithRetry(url)

      if (res.ok) {
        const data = await res.json() as any
        const msg = data?.messages?.[0]
        if (msg) {
          status      = msg.status ?? 'pending'
          attestation = msg.attestation ?? null
        }
      } else if (res.status === 404) {
        // 404 = message belum ada di Iris, masih pending — normal
        status = 'pending'
      } else {
        errors.push(`V2 HTTP ${res.status}`)
      }
    } catch (e: any) {
      errors.push(`V2 error: ${e?.message}`)
      console.error('[attestation] Iris V2 fetch failed:', e?.message)
    }
  }

  // ── Return result ─────────────────────────────────────────────────────
  // Jika ada error tapi belum ada attestation, return pending (bukan 500)
  // agar client bisa retry polling
  if (errors.length > 0 && !attestation) {
    return json({
      ok: true,  // ok: true agar client tidak stop polling
      status: 'pending',
      attestation: null,
      errors,
      hint: 'Iris API mungkin sedang lambat. Polling akan dilanjutkan.',
    })
  }

  return json({
    ok: true,
    status,
    attestation: attestation ?? null,
  })
}
