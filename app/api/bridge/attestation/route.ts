/**
 * app/api/bridge/attestation/route.ts
 * Proxy ke Circle Iris API v2 (CCTP V2).
 * Endpoint: /v2/messages/{sourceDomainId}?transactionHash={hash}
 *
 * NOTE: BridgeKit poll Iris langsung dari browser.
 * Route ini hanya untuk diagnostik atau fallback manual.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { IRIS_API, ARC_CCTP_DOMAIN, SEPOLIA_CCTP_DOMAIN } from '@/lib/arcChain'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const txHash      = searchParams.get('txHash')
  const domainIdStr = searchParams.get('sourceDomainId')

  // Diagnostik endpoint
  if (searchParams.get('test') === '1') {
    try {
      const res = await fetch(`${IRIS_API}/v2/attestations/0x${'0'.repeat(64)}`, {
        headers: { Accept: 'application/json' },
        signal:  AbortSignal.timeout(8_000),
      })
      return NextResponse.json({ ok: true, irisUrl: IRIS_API, httpStatus: res.status, reachable: true })
    } catch (e: any) {
      return NextResponse.json({ ok: false, irisUrl: IRIS_API, error: e.message, reachable: false }, { status: 502 })
    }
  }

  if (!txHash || !domainIdStr) {
    return NextResponse.json({ error: 'txHash dan sourceDomainId wajib diisi' }, { status: 400 })
  }

  const domainId = parseInt(domainIdStr)
  if (domainId !== ARC_CCTP_DOMAIN && domainId !== SEPOLIA_CCTP_DOMAIN) {
    return NextResponse.json({ error: 'sourceDomainId tidak valid' }, { status: 400 })
  }

  try {
    // CCTP V2 endpoint
    const url = `${IRIS_API}/v2/messages/${domainId}?transactionHash=${txHash}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal:  AbortSignal.timeout(10_000),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 })
  }
}
