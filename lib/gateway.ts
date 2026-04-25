/**
 * lib/gateway.ts
 * Circle Gateway — unified USDC balance & instant transfer (<500ms).
 * Ref: https://developers.circle.com/api-reference/gateway
 *
 * Endpoint: https://api.circle.com/v1/gateway/
 * Auth: Bearer token (CIRCLE_API_KEY — server-side only)
 *
 * CATATAN: Gateway transfer lebih cepat dari CCTP untuk amount kecil (<10 USDC).
 * Gunakan sebagai alternatif bridge untuk micropayment.
 */

const GATEWAY_BASE = 'https://api.circle.com/v1/gateway'

function getApiKey(): string {
  // Server-side: gunakan CIRCLE_API_KEY (tidak di-expose ke client)
  // Client-side: gunakan NEXT_PUBLIC_CIRCLE_API_KEY
  const key =
    (typeof process !== 'undefined' && process.env?.CIRCLE_API_KEY) ||
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CIRCLE_API_KEY) ||
    ''
  return key
}

function gatewayHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${getApiKey()}`,
  }
}

export interface GatewayBalance {
  chain: string
  amount: string
  currency: string
}

export interface GatewayTransferParams {
  sourceChain: string
  destinationChain: string
  amount: string
  walletAddress: string
  destinationAddress?: string
}

export interface GatewayTransfer {
  id: string
  status: 'pending' | 'complete' | 'failed'
  amount: string
  sourceChain: string
  destinationChain: string
  txHash?: string
  createDate?: string
}

/**
 * GET /v1/gateway/token/balances
 * Ambil unified USDC balance di semua chain untuk wallet address.
 */
export async function getGatewayBalances(walletAddress: string): Promise<GatewayBalance[]> {
  const res = await fetch(
    `${GATEWAY_BASE}/token/balances?walletAddress=${walletAddress}`,
    {
      headers: gatewayHeaders(),
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    },
  )
  if (!res.ok) throw new Error(`Gateway balance error: ${res.status}`)
  const data = await res.json() as any
  return (data?.data?.balances ?? data?.balances ?? []) as GatewayBalance[]
}

/**
 * POST /v1/gateway/transfers
 * Inisiasi instant transfer (<500ms) via Circle Gateway.
 */
export async function createGatewayTransfer(params: GatewayTransferParams): Promise<GatewayTransfer> {
  const body = {
    source: {
      chain: params.sourceChain,
      walletAddress: params.walletAddress,
    },
    destination: {
      chain: params.destinationChain,
      walletAddress: params.destinationAddress ?? params.walletAddress,
    },
    amount: {
      currency: 'USD',
      amount: params.amount,
    },
  }

  const res = await fetch(`${GATEWAY_BASE}/transfers`, {
    method: 'POST',
    headers: gatewayHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    throw new Error(err?.message ?? `Gateway transfer error: ${res.status}`)
  }
  const data = await res.json() as any
  return (data?.data ?? data) as GatewayTransfer
}

/**
 * GET /v1/gateway/transfers/{id}
 * Poll status transfer Gateway.
 */
export async function getGatewayTransferStatus(id: string): Promise<GatewayTransfer> {
  const res = await fetch(`${GATEWAY_BASE}/transfers/${id}`, {
    headers: gatewayHeaders(),
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Gateway status error: ${res.status}`)
  const data = await res.json() as any
  return (data?.data ?? data) as GatewayTransfer
}

/**
 * Poll sampai transfer selesai atau timeout.
 * Gateway biasanya <500ms, tapi poll sampai 30 detik untuk safety.
 */
export async function pollGatewayTransfer(
  id: string,
  onProgress?: (status: string) => void,
  maxMs = 30_000,
): Promise<GatewayTransfer> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const transfer = await getGatewayTransferStatus(id)
    if (transfer.status === 'complete') return transfer
    if (transfer.status === 'failed')  throw new Error('Gateway transfer gagal')
    onProgress?.(`Gateway transfer ${transfer.status}…`)
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Gateway transfer timeout')
}
