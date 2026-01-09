// app/api/_utils/store.js
// KV (Vercel) if available, otherwise in-memory with TTL.

const MEM_KEY = "__ARC_GATE_MEM__";
if (!globalThis[MEM_KEY]) globalThis[MEM_KEY] = new Map();

function now() {
  return Date.now();
}

function memGet(key) {
  const item = globalThis[MEM_KEY].get(key);
  if (!item) return null;
  if (item.exp && now() > item.exp) {
    globalThis[MEM_KEY].delete(key);
    return null;
  }
  return item.val;
}

function memSet(key, val, ttlSec) {
  const exp = ttlSec ? now() + ttlSec * 1000 : null;
  globalThis[MEM_KEY].set(key, { val, exp });
}

async function getKv() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  const mod = await import("@vercel/kv");
  return mod.kv;
}

export async function storeGet(key) {
  const kv = await getKv();
  if (kv) {
    const v = await kv.get(key);
    return v ?? null;
  }
  return memGet(key);
}

export async function storeSet(key, val, ttlSec) {
  const kv = await getKv();
  if (kv) {
    if (ttlSec) await kv.set(key, val, { ex: ttlSec });
    else await kv.set(key, val);
    return;
  }
  memSet(key, val, ttlSec);
}

export async function storeDel(key) {
  const kv = await getKv();
  if (kv) {
    await kv.del(key);
    return;
  }
  globalThis[MEM_KEY].delete(key);
}
