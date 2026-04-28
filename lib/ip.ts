/**
 * lib/ip.ts
 * Ekstrak client IP dari request headers Next.js.
 * Dipakai oleh: /api/faucet, /api/free-claim
 */

/**
 * Ambil IP client dari headers.
 * Urutan: x-forwarded-for → x-real-ip → cf-connecting-ip → '0.0.0.0'
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? ''
  // x-forwarded-for bisa berisi "client, proxy1, proxy2" — ambil yang pertama
  const first = xff.split(',')[0].trim()
  if (first) return first

  const xri = (req.headers.get('x-real-ip') ?? '').trim()
  if (xri) return xri

  const cf = (req.headers.get('cf-connecting-ip') ?? '').trim()
  if (cf) return cf

  return '0.0.0.0'
}
