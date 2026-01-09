/**
 * Simple storage layer:
 * - Uses Vercel KV if KV_REST_API_URL + KV_REST_API_TOKEN exist
 * - Falls back to in-memory Map for local/dev (NOT reliable on serverless)
 */
let kvClient = null;
let hasKv = false;

try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    // Dynamic import to avoid bundling issues if not installed
    const mod = await import("@vercel/kv");
    kvClient = mod.kv;
    hasKv = true;
  }
} catch (e) {
  hasKv = false;
}

const mem = globalThis.__ACG_MEM__ || (globalThis.__ACG_MEM__ = new Map());

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function memRead(key) {
  const v = mem.get(key);
  if (!v) return null;
  if (typeof v === "object" && v !== null && v.__expiresAt) {
    if (v.__expiresAt <= nowSec()) {
      mem.delete(key);
      return null;
    }
    return v.value;
  }
  return v;
}

function memWrite(key, value, ex) {
  if (ex) mem.set(key, { value, __expiresAt: nowSec() + ex });
  else mem.set(key, value);
}

export async function get(key) {
  if (hasKv) return kvClient.get(key);
  return memRead(key);
}

export async function set(key, value, { ex } = {}) {
  if (hasKv) {
    if (ex) return kvClient.set(key, value, { ex });
    return kvClient.set(key, value);
  }
  memWrite(key, value, ex);
}

export async function del(key) {
  if (hasKv) return kvClient.del(key);
  mem.delete(key);
}

export async function exists(key) {
  const v = await get(key);
  return v !== null && v !== undefined;
}

// Best-effort increment with TTL support (atomic when KV is enabled)
export async function incr(key) {
  if (hasKv && typeof kvClient.incr === "function") {
    return await kvClient.incr(key);
  }

  const cur = Number(await get(key) || 0);
  const next = cur + 1;
  // note: no TTL changes here
  await set(key, next);
  return next;
}

export async function expire(key, ex) {
  if (hasKv && typeof kvClient.expire === "function") {
    return await kvClient.expire(key, ex);
  }

  const cur = await get(key);
  if (cur === null || cur === undefined) return 0;
  memWrite(key, cur, ex);
  return 1;
}
