/**
 * lib/arcSend.ts
 * Server-side: kirim USDC dari treasury wallet di Arc Testnet.
 * Dipakai oleh: /api/faucet, /api/free-claim, /api/faucet/status
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  fallback,
  erc20Abi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet, ARC_USDC, ARC_RPC_URLS } from './arcChain'

const arcTransport = fallback(ARC_RPC_URLS.map(url => http(url)))

/**
 * Normalisasi private key — tambah 0x prefix jika belum ada.
 */
function normalizePk(raw: string): `0x${string}` {
  const clean = raw.trim().replace(/^['"]|['"]$/g, '')
  const hex = clean.startsWith('0x') ? clean : `0x${clean}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'ARC_TREASURY_PRIVATE_KEY harus 64 karakter hex (dengan atau tanpa 0x prefix)'
    )
  }
  return hex as `0x${string}`
}

/**
 * Buat account dari ARC_TREASURY_PRIVATE_KEY env.
 */
export function getArcTreasuryAccount() {
  const pk = process.env.ARC_TREASURY_PRIVATE_KEY
  if (!pk) throw new Error('ARC_TREASURY_PRIVATE_KEY tidak di-set')
  return privateKeyToAccount(normalizePk(pk))
}

/**
 * Cek saldo USDC di Arc untuk address tertentu.
 * Return BigInt dalam 6 decimals.
 */
export async function getArcUsdcBalance6(address: `0x${string}`): Promise<bigint> {
  const client = createPublicClient({
    chain: arcTestnet,
    transport: arcTransport,
  })
  return client.readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  })
}

/**
 * Kirim USDC dari treasury ke address tujuan di Arc Testnet.
 * @param params.to - Alamat tujuan (string atau `0x${string}`)
 * @param params.amount6 - Jumlah dalam 6 decimals (misal 10 USDC = 10_000_000n)
 * @returns txHash
 */
export async function sendArcUsdc({
  to,
  amount6,
}: {
  to: string
  amount6: bigint
}): Promise<`0x${string}`> {
  const account = getArcTreasuryAccount()

  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: arcTransport,
  })

  const hash = await walletClient.writeContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to as `0x${string}`, amount6],
    account,
    gas: 100_000n,
  })

  return hash
}
