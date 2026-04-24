import { NextResponse } from 'next/server'
import { get as storeGet } from '@/lib/store'

const COOLDOWN_MS = Number(process.env.FREE_CLAIM_COOLDOWN_MS || 3600000)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const wallet = body.wallet?.toLowerCase()

    if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ remaining: 0 })
    }

    const now = Date.now()
    const lastClaimStr = await storeGet(`free-claim:${wallet}`)
    if (lastClaimStr) {
      const last = parseInt(String(lastClaimStr), 10)
      const remaining = COOLDOWN_MS - (now - last)
      return NextResponse.json({ remaining: remaining > 0 ? remaining : 0 })
    }

    return NextResponse.json({ remaining: 0 })
  } catch {
    return NextResponse.json({ remaining: 0 })
  }
}
