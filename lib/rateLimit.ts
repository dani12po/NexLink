/**
 * lib/rateLimit.ts
 * Fixed-window rate limiter — Vercel KV jika tersedia, fallback ke in-memory.
 * Dipakai oleh: /api/faucet, /api/free-claim
 */
import { get, incr, expire } from './store'

export interface RateLimitOptions {
  key: string       // unique key, e.g. "faucet:0xabc..."
  limit: number     // max requests per window
  windowSec: number // window size in seconds
}

export interface RateLimitResult {
  ok: boolean
  retryAfter: number  // seconds until reset (0 jika ok)
  limit: number
  remaining: number
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Fixed-window rate limit.
 * - key: logical key (e.g. "claim:1.2.3.4")
 * - limit: max hits per window
 * - windowSec: window size in seconds
 */
export async function rateLimit({ key, limit, windowSec }: RateLimitOptions): Promise<RateLimitResult> {
  const t = nowSec()
  const bucket = Math.floor(t / windowSec)
  const k = `rl:${key}:${bucket}`

  // Atomic INCR — works with both KV and in-memory
  const count = await incr(k)
  if (count === 1) {
    // First hit in this window — set TTL slightly longer than window
    await expire(k, windowSec + 5)
  } else {
    // Re-apply TTL on subsequent hits (best-effort for in-memory)
    const v = await get(k)
    if (v !== null) {
      await expire(k, windowSec + 5)
    }
  }

  if (count > limit) {
    const resetAt = (bucket + 1) * windowSec
    const retryAfter = Math.max(1, resetAt - t)
    return { ok: false, retryAfter, limit, remaining: 0 }
  }

  return { ok: true, retryAfter: 0, limit, remaining: Math.max(0, limit - count) }
}
