import { NextResponse } from 'next/server'
import { sendArcUsdc } from '@/lib/arcSend'
import { get as storeGet, set as storeSet } from '@/lib/store'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/ip'

const COOLDOWN_MS = Number(process.env.FREE_CLAIM_COOLDOWN_MS || 7200000)
const COOLDOWN_SEC = Math.ceil(COOLDOWN_MS / 1000)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const wallet = body.wallet?.toLowerCase()

    // Validasi wallet
    if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }

    console.log('[FREE-CLAIM] wallet:', wallet)

    const now = Date.now()
    const storeKey = `free-claim:${wallet}`

    // Cek cooldown per wallet
    const lastStr = await storeGet(storeKey)
    if (lastStr) {
      const last = Number(lastStr)
      const diff = now - last
      if (diff < COOLDOWN_MS) {
        const remaining = COOLDOWN_MS - diff
        return NextResponse.json({ error: 'Cooldown active', remaining }, { status: 429 })
      }
    }

    // IP rate limit — max 3 claim berbeda per IP per window
    const ip = getClientIp(req)
    if (ip && ip !== '0.0.0.0') {
      const ipRl = await rateLimit({
        key: `free-claim-ip:${ip}`,
        limit: 3,
        windowSec: COOLDOWN_SEC,
      })
      if (!ipRl.ok) {
        return NextResponse.json(
          { error: 'Too many requests from this IP', retryAfter: ipRl.retryAfter },
          { status: 429 }
        )
      }
    }

    // Kirim USDC
    const reward = process.env.FREE_CLAIM_REWARD_AMOUNT || '5'
    const amount6 = BigInt(Math.round(parseFloat(reward) * 1_000_000))
    const txHash = await sendArcUsdc({ to: wallet, amount6 })

    // Simpan timestamp claim
    await storeSet(storeKey, now, { ex: COOLDOWN_SEC + 60 })

    return NextResponse.json({ ok: true, txHash })
  } catch (e: any) {
    console.error('[FREE-CLAIM ERROR]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
