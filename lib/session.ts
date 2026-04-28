/**
 * lib/session.ts
 * Session management berbasis cookie SID + KV store.
 * Dipakai oleh: /api/session/route.js, /api/x/follow/route.js
 */
import { cookies } from 'next/headers'
import { get, set } from './store'

const COOKIE_NAME = 'sid'
const DEFAULT_TTL = 60 * 60 * 24 * 7 // 7 hari

export interface SessionData {
  wallet?: string
  x?: {
    connected: boolean
    followed: boolean
    username?: string
    userId?: string
    access_token?: string
    user?: { id: string; username: string }
  }
  [key: string]: unknown
}

export interface SessionResult {
  sid: string
  key: string
  data: SessionData
}

/**
 * Ambil atau buat session dari cookie.
 * Return { sid, key, data } — data adalah object session saat ini.
 */
export async function getSession(): Promise<SessionResult> {
  const cookieStore = cookies()
  let sid = cookieStore.get(COOKIE_NAME)?.value ?? ''

  if (!sid) {
    sid = crypto.randomUUID()
    cookieStore.set(COOKIE_NAME, sid, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: DEFAULT_TTL,
    })
  }

  const key = `sess:${sid}`
  const raw = await get(key)

  let data: SessionData = {}
  if (raw) {
    try {
      data = typeof raw === 'string' ? JSON.parse(raw) : (raw as SessionData)
    } catch {
      data = {}
    }
  }

  return { sid, key, data }
}

/**
 * Simpan data session ke store.
 * @param sid - Session ID
 * @param data - Data session yang akan disimpan
 * @param ttlSec - TTL dalam detik (default 7 hari)
 */
export async function saveSession(
  sid: string,
  data: SessionData,
  ttlSec: number = DEFAULT_TTL
): Promise<void> {
  const key = `sess:${sid}`
  await set(key, JSON.stringify(data), { ex: ttlSec })
}
