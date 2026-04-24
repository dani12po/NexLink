import { incr, expire, get } from "./store.js";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Fixed-window rate limit.
 * - key: logical key (e.g. "claim:1.2.3.4")
 * - limit: max hits per window
 * - windowSec: window size in seconds
 */
export async function rateLimit({ key, limit, windowSec }) {
  const t = nowSec();
  const bucket = Math.floor(t / windowSec);
  const k = `rl:${key}:${bucket}`;

  // Prefer atomic INCR if KV available; fallback is best-effort.
  const count = await incr(k);
  if (count === 1) {
    // set TTL slightly longer than window
    await expire(k, windowSec + 5);
  } else {
    // If fallback path lost TTL, re-apply (best-effort)
    const v = await get(k);
    if (v === count) {
      await expire(k, windowSec + 5);
    }
  }

  if (count > limit) {
    const resetAt = (bucket + 1) * windowSec;
    const retryAfter = Math.max(1, resetAt - t);
    return { ok: false, retryAfter, limit, remaining: 0 };
  }

  return { ok: true, retryAfter: 0, limit, remaining: Math.max(0, limit - count) };
}
