/**
 * lib/arcSend.js
 * Server-side: kirim USDC dari treasury wallet di Arc Testnet.
 * Dipakai oleh: /api/faucet, /api/free-claim, /api/faucet/status
 */
import { createWalletClient, createPublicClient, http, fallback, parseUnits, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const ARC_CHAIN_ID = 5042002
const ARC_RPC_URLS = [
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? 'https://rpc.testnet.arc.network',
  'https://rpc.blockdaemon.testnet.arc.network',
  'https://rpc.drpc.testnet.arc.network',
]
const ARC_USDC = '0x3600000000000000000000000000000000000000'

const arcChain = {
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URLS[0]] } },
}

const arcTransport = fallback(ARC_RPC_URLS.map(url => http(url)))

export function getArcTreasuryAccount() {
  const pk = process.env.ARC_TREASURY_PRIVATE_KEY
  if (!pk) throw new Error('ARC_TREASURY_PRIVATE_KEY tidak di-set')
  const clean = pk.trim().replace(/^['"]|['"]$/g, '')
  const hex = clean.startsWith('0x') ? clean : `0x${clean}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Format private key salah')
  return privateKeyToAccount(hex)
}

export async function getArcUsdcBalance6(address) {
  const client = createPublicClient({ chain: arcChain, transport: arcTransport })
  return client.readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  })
}

/**
 * Kirim USDC dari treasury ke address tujuan.
 * @param {Object} params
 * @param {string} params.to - Alamat tujuan
 * @param {bigint} params.amount6 - Jumlah dalam 6 decimals (misal 10 USDC = 10_000_000n)
 * @returns {Promise<string>} txHash
 */
export async function sendArcUsdc({ to, amount6 }) {
  const account = getArcTreasuryAccount()
  const walletClient = createWalletClient({
    account,
    chain: arcChain,
    transport: arcTransport,
  })

  const hash = await walletClient.writeContract({
    address:      ARC_USDC,
    abi:          erc20Abi,
    functionName: 'transfer',
    args:         [to, amount6],
    account,
    gas:          100_000n,
  })

  return hash
}
