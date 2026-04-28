/**
 * lib/store.ts
 * KV store abstraction — Vercel KV jika tersedia, fallback ke in-memory.
 * Dipakai oleh: rateLimit.ts, free-claim route, session.ts
 */

// ─── In-memory fallback ───────────────────────────────────────────────────────
interface MemEntry {
  val: string | number
  exp: number | null
}

const mem: Map<string, MemEntry> = (globalThis as any).__KV_MEM__ ??
  ((globalThis as any).__KV_MEM__ = new Map<string, MemEntry>())

function memGet(key: string): string | null {
  const entry = mem.get(key)
  if (!entry) return null
  if (entry.exp && Date.now() > entry.exp) { mem.delete(key); return null }
  return String(entry.val)
}

function memSet(key: string, val: string | number, opts?: { ex?: number }): void {
  const exp = opts?.ex ? Date.now() + opts.ex * 1000 : null
  mem.set(key, { val, exp })
}

function memIncr(key: string): number {
  const cur = parseInt(memGet(key) ?? '0', 10)
  const next = cur + 1
  const entry = mem.get(key)
  mem.set(key, { val: next, exp: entry?.exp ?? null })
  return next
}

function memExpire(key: string, seconds: number): void {
  const entry = mem.get(key)
  if (entry) mem.set(key, { ...entry, exp: Date.now() + seconds * 1000 })
}

function memDel(key: string): boolean {
  return mem.delete(key)
}

// ─── Vercel KV (optional) ─────────────────────────────────────────────────────
let kv: any = null
async function getKv(): Promise<any> {
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
export async function get(key: string): Promise<string | null> {
  const store = await getKv()
  if (store) return store.get(key)
  return memGet(key)
}

export async function set(key: string, val: string | number, opts?: { ex?: number }): Promise<void> {
  const store = await getKv()
  if (store) return store.set(key, val, opts)
  memSet(key, val, opts)
}

export async function incr(key: string): Promise<number> {
  const store = await getKv()
  if (store) return store.incr(key)
  return memIncr(key)
}

export async function expire(key: string, seconds: number): Promise<void> {
  const store = await getKv()
  if (store) return store.expire(key, seconds)
  memExpire(key, seconds)
}

export async function del(key: string): Promise<void> {
  const store = await getKv()
  if (store) return store.del(key)
  memDel(key)
}
