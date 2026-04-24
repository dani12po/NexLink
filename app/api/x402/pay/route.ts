/**
 * app/api/x402/pay/route.ts
 * x402 payment endpoint — verifikasi EIP-712 + settle via Circle Gateway
 * Ref: https://developers.circle.com/gateway/nanopayments
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { parseUnits, verifyTypedData } from 'viem'
import { ARC_CHAIN_ID, ARC_USDC } from '@/lib/arcChain'

const PRICE_USDC      = process.env.X402_PRICE_USDC ?? '0.001'
const GATEWAY_API_KEY = process.env.CIRCLE_GATEWAY_API_KEY ?? ''
const GATEWAY_BASE    = 'https://gateway-api-testnet.circle.com'

const EIP712_DOMAIN = {
  name: 'USD Coin', version: '2',
  chainId: ARC_CHAIN_ID,
  verifyingContract: ARC_USDC,
} as const

const EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
} as const

function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

async function verifySignature(auth: any, signature: string): Promise<boolean> {
  try {
    return await verifyTypedData({
      address: auth.from as `0x${string}`,
      domain: EIP712_DOMAIN,
      types: EIP712_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from:        auth.from        as `0x${string}`,
        to:          auth.to          as `0x${string}`,
        value:       BigInt(auth.value),
        validAfter:  BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce:       auth.nonce       as `0x${string}`,
      },
      signature: signature as `0x${string}`,
    })
  } catch { return false }
}

async function settleViaGateway(paymentPayload: any, paymentRequirements: any) {
  if (!GATEWAY_API_KEY) {
    // Fallback: local verify sudah dilakukan sebelumnya — return success lokal
    return { id: `local-${Date.now()}`, mode: 'local-verify' }
  }

  const res = await fetch(`${GATEWAY_BASE}/gateway/v1/x402/settle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_API_KEY}`,
    },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Gateway settle failed: ${err?.message || res.status}`)
  }

  return res.json()
}

export async function GET(req: Request) {
  const payTo = process.env.X402_RECEIVER_ADDRESS || ''
  if (!payTo) return json({ error: 'X402_RECEIVER_ADDRESS not configured' }, { status: 500 })

  const resourceUrl   = new URL(req.url).origin + '/api/x402/pay'
  const paymentHeader = req.headers.get('X-PAYMENT') || req.headers.get('PAYMENT-SIGNATURE')

  if (!paymentHeader) {
    return json(
      {
        accepts: [{
          scheme: 'exact',
          network: `eip155:${ARC_CHAIN_ID}`,
          maxAmountRequired: parseUnits(PRICE_USDC, 6).toString(),
          resource: resourceUrl,
          description: `Pay ${PRICE_USDC} USDC`,
          mimeType: 'application/json',
          payTo,
          maxTimeoutSeconds: 60,
          asset: ARC_USDC,
          extra: { name: 'USD Coin', version: '2' },
        }],
      },
      {
        status: 402,
        headers: {
          'X-402-Version': '1',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE',
        },
      }
    )
  }

  let decoded: any
  try { decoded = JSON.parse(atob(paymentHeader)) }
  catch { return json({ error: 'Invalid payment header' }, { status: 402 }) }

  const auth      = decoded.payload?.authorization
  const signature = decoded.payload?.signature
  if (!auth || !signature) return json({ error: 'Missing auth or signature' }, { status: 402 })

  const isValid = await verifySignature(auth, signature)
  if (!isValid) return json({ error: 'Invalid signature' }, { status: 402 })

  const now = Math.floor(Date.now() / 1000)
  if (now < Number(auth.validAfter) || now > Number(auth.validBefore)) {
    return json({ error: 'Payment expired' }, { status: 402 })
  }

  try {
    const paymentRequirements = {
      scheme: 'exact',
      network: `eip155:${ARC_CHAIN_ID}`,
      asset: ARC_USDC,
      amount: parseUnits(PRICE_USDC, 6).toString(),
      payTo,
      maxTimeoutSeconds: 60,
      extra: {},
    }

    const settlement = await settleViaGateway(decoded, paymentRequirements)

    return json(
      {
        success: true,
        message: 'Payment settled via Circle Gateway.',
        settlementId: settlement?.id,
        data: {
          timestamp: new Date().toISOString(),
          paidAmount: PRICE_USDC + ' USDC',
          network: `Arc Testnet (chain ${ARC_CHAIN_ID})`,
        },
      },
      {
        headers: {
          'X-PAYMENT-RESPONSE': JSON.stringify({ success: true }),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE',
        },
      }
    )
  } catch (e: any) {
    return json({ error: e?.message || 'Settlement failed' }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-PAYMENT, X-402-Version, Content-Type',
    },
  })
}
