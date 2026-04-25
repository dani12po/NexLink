/**
 * lib/store.js
 * KV store abstraction — Vercel KV jika tersedia, fallback ke in-memory.
 * Dipakai oleh: rateLimit.js, free-claim route, session.js
 */

// ─── In-memory fallback ───────────────────────────────────────────────────────
const mem = new Map()

function memGet(key) {
  const entry = mem.get(key)
  if (!entry) return null
  if (entry.exp && Date.now() > entry.exp) { mem.delete(key); return null }
  return entry.val
}

function memSet(key, val, opts) {
  const exp = opts?.ex ? Date.now() + opts.ex * 1000 : null
  mem.set(key, { val, exp })
}

function memIncr(key) {
  const cur = parseInt(memGet(key) ?? '0', 10)
  const next = cur + 1
  const entry = mem.get(key)
  mem.set(key, { val: next, exp: entry?.exp ?? null })
  return next
}

// ─── Vercel KV (optional) ─────────────────────────────────────────────────────
let kv = null
async function getKv() {
  if (kv) return kv
  try {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const mod = await import('@vercel/kv')
      kv = mod.kv
    }
  } catch { /* not available */ }
  return kv
}

// ─── Public API ───────────────────────────────────────────────────────────────
export async function get(key) {
  const store = await getKv()
  if (store) return store.get(key)
  return memGet(key)
}

export async function set(key, val, opts) {
  const store = await getKv()
  if (store) return store.set(key, val, opts)
  memSet(key, val, opts)
}

export async function incr(key) {
  const store = await getKv()
  if (store) return store.incr(key)
  return memIncr(key)
}

export async function expire(key, seconds) {
  const store = await getKv()
  if (store) return store.expire(key, seconds)
  const entry = mem.get(key)
  if (entry) mem.set(key, { ...entry, exp: Date.now() + seconds * 1000 })
}
