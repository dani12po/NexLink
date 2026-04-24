export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { sendArcUsdc } from '@/lib/arcSend'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/ip'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { wallet } = body

    if (!wallet || !/^0x[a-f0-9]{40}$/i.test(wallet)) {
      return NextResponse.json({ ok: false, error: 'Invalid wallet' }, { status: 400 })
    }

    // Rate limit per wallet
    const rl = await rateLimit({
      key: `faucet:${wallet.toLowerCase()}`,
      limit: 1,
      windowSec: Number(process.env.WALLET_CLAIM_COOLDOWN_SEC || 7200),
    })
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: `Rate limited. Retry in ${rl.retryAfter}s`, retryAfter: rl.retryAfter },
        { status: 429 }
      )
    }

    // IP rate limit — max 5 req/IP per 2 jam
    const ip = getClientIp(req)
    if (ip && ip !== '0.0.0.0') {
      const ipRl = await rateLimit({
        key: `faucet-ip:${ip}`,
        limit: 5,
        windowSec: Number(process.env.WALLET_CLAIM_COOLDOWN_SEC || 7200),
      })
      if (!ipRl.ok) {
        return NextResponse.json(
          { ok: false, error: `IP rate limited. Retry in ${ipRl.retryAfter}s` },
          { status: 429 }
        )
      }
    }

    const reward = process.env.REWARD_USDC || '10'
    const amount6 = BigInt(Math.round(parseFloat(reward) * 1_000_000))
    const hash = await sendArcUsdc({ to: wallet, amount6 })

    return NextResponse.json({
      ok: true,
      txHash: hash,
      arcExplorerUrl: `https://testnet.arcscan.app/tx/${hash}`,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Server error' }, { status: 500 })
  }
}
