/**
 * lib/x402Client.ts
 * x402 payment protocol client helper
 * Sumber: https://docs.x402.org / https://developers.circle.com/gateway/nanopayments
 *
 * x402 = HTTP 402 Payment Required protocol
 * Flow: client request → server 402 + payment terms → client pays onchain → retry with payment header
 */

import { parseUnits, type WalletClient, type PublicClient } from 'viem'

export interface PaymentRequirement {
  scheme: string
  network: string
  maxAmountRequired: string
  resource: string
  description?: string
  mimeType?: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  extra?: Record<string, unknown>
}

export interface X402PaymentHeader {
  x402Version: number
  scheme: string
  network: string
  payload: {
    signature: string
    authorization: {
      from: string
      to: string
      value: string
      validAfter: string
      validBefore: string
      nonce: string
    }
  }
}

/**
 * Parse 402 response dan ambil payment requirements
 */
export async function parsePaymentRequired(response: Response): Promise<PaymentRequirement | null> {
  if (response.status !== 402) return null
  try {
    const data = await response.clone().json()
    // x402 standard: { accepts: [...] } atau langsung array
    const accepts = data?.accepts ?? (Array.isArray(data) ? data : [data])
    return accepts?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * Build EIP-3009 transferWithAuthorization signature untuk x402 exact scheme
 * Ini adalah "exact" scheme — bayar tepat sejumlah yang diminta
 */
export async function buildX402PaymentHeader(params: {
  walletClient: WalletClient
  publicClient: PublicClient
  requirement: PaymentRequirement
  usdcAddress: `0x${string}`
  chainId: number
}): Promise<string> {
  const { walletClient, requirement, usdcAddress, chainId } = params
  const account = walletClient.account
  if (!account) throw new Error('No account connected')

  const amount = requirement.maxAmountRequired
  const to = requirement.payTo as `0x${string}`
  const validAfter = BigInt(Math.floor(Date.now() / 1000) - 10)
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + (requirement.maxTimeoutSeconds ?? 60))
  const nonce = `0x${crypto.randomUUID().replace(/-/g, '')}` as `0x${string}`

  // EIP-712 domain untuk USDC transferWithAuthorization
  const domain = {
    name: 'USD Coin',
    version: '2',
    chainId,
    verifyingContract: usdcAddress,
  }

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  }

  const message = {
    from: account.address,
    to,
    value: BigInt(amount),
    validAfter,
    validBefore,
    nonce,
  }

  const signature = await walletClient.signTypedData({
    account,
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  })

  const payload: X402PaymentHeader = {
    x402Version: 1,
    scheme: 'exact',
    network: `eip155:${chainId}`,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to,
        value: amount,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  }

  return btoa(JSON.stringify(payload))
}

/**
 * Kirim micropayment x402 ke endpoint yang membutuhkan pembayaran
 */
export async function fetchWithX402(
  url: string,
  options: RequestInit,
  walletClient: WalletClient,
  publicClient: PublicClient,
  usdcAddress: `0x${string}`,
  chainId: number
): Promise<Response> {
  // Request pertama
  const firstResponse = await fetch(url, options)

  if (firstResponse.status !== 402) return firstResponse

  // Parse payment requirement
  const requirement = await parsePaymentRequired(firstResponse)
  if (!requirement) throw new Error('Invalid 402 response: missing payment requirement')

  // Build payment header
  const paymentHeader = await buildX402PaymentHeader({
    walletClient,
    publicClient,
    requirement,
    usdcAddress,
    chainId,
  })

  // Retry dengan payment header
  const retryResponse = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      'X-PAYMENT': paymentHeader,
      'X-402-Version': '1',
    },
  })

  return retryResponse
}
