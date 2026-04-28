// app/api/_utils/store.js
// Re-export dari lib/store.ts untuk backward compatibility
// storeSet menerima TTL sebagai angka (detik) ATAU object { ex: number }
import { get, set, del } from '../../../lib/store'

export const storeGet = get

/**
 * storeSet — wrapper yang menerima TTL sebagai angka atau object { ex }
 * @param {string} key
 * @param {*} value
 * @param {number|{ex:number}|undefined} ttl
 */
export async function storeSet(key, value, ttl) {
  if (typeof ttl === 'number') {
    return set(key, value, { ex: ttl })
  }
  return set(key, value, ttl)
}

export const storeDel = del
