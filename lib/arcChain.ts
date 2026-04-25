/**
 * lib/arcChain.ts
 * Chain config dan contract addresses untuk Arc Testnet & Ethereum Sepolia.
 * Sumber: https://docs.arc.network/arc/references/contract-addresses
 */
import { createPublicClient, http, fallback, defineChain } from 'viem'
import { sepolia } from 'viem/chains'

// ─── BridgeKit Chain Identifiers ─────────────────────────────────────────────
// String exact yang dipakai @circle-fin/bridge-kit
export const CHAIN_ARC     = 'Arc_Testnet'      as const
export const CHAIN_SEPOLIA = 'Ethereum_Sepolia'  as const

// Backward compat aliases
export const BRIDGE_KIT_CHAIN_ARC     = CHAIN_ARC
export const BRIDGE_KIT_CHAIN_SEPOLIA = CHAIN_SEPOLIA

// ─── Arc Testnet ─────────────────────────────────────────────────────────────
export const ARC_CHAIN_ID     = 5042002
export const ARC_CHAIN_ID_HEX = '0x4cef52'
export const ARC_EXPLORER     = 'https://testnet.arcscan.app'
export const ARC_FAUCET       = 'https://faucet.circle.com'

// RPC dengan fallback
export const ARC_RPC_URLS = [
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? 'https://rpc.testnet.arc.network',
  'https://rpc.blockdaemon.testnet.arc.network',
  'https://rpc.drpc.testnet.arc.network',
] as const
export const ARC_RPC = ARC_RPC_URLS[0]
export const ARC_RPC_BACKUP  = ARC_RPC_URLS[1]
export const ARC_RPC_BACKUP2 = ARC_RPC_URLS[2]

// viem chain definition — decimals 18 wajib untuk wagmi, USDC actual = 6
export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URLS[0]] },
    public:  { http: [ARC_RPC_URLS[0]] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: ARC_EXPLORER },
  },
})

// ─── Arc Contract Addresses ──────────────────────────────────────────────────
export const ARC_USDC            = '0x3600000000000000000000000000000000000000' as `0x${string}`
export const ARC_EURC            = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as `0x${string}`
export const ARC_USYC            = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C' as `0x${string}`
export const ARC_FX_ESCROW       = '0x867650F5eAe8df91445971f14d89fd84F0C9a9f8' as `0x${string}`
export const ARC_MULTICALL3      = '0xcA11bde05977b3631167028862bE2a173976CA11' as `0x${string}`
export const ARC_TOKEN_MESSENGER = (
  process.env.NEXT_PUBLIC_ARC_TOKEN_MESSENGER ?? '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
) as `0x${string}`
export const ARC_MESSAGE_TRANSMITTER = (
  process.env.NEXT_PUBLIC_ARC_MESSAGE_TRANSMITTER ?? '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
) as `0x${string}`

// ─── Ethereum Sepolia ─────────────────────────────────────────────────────────
export const SEPOLIA_CHAIN_ID      = 11155111
export const SEPOLIA_CHAIN_ID_HEX  = '0xaa36a7'
export const SEPOLIA_EXPLORER      = 'https://sepolia.etherscan.io'
export const SEPOLIA_USDC          = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as `0x${string}`
export const SEPOLIA_TOKEN_MESSENGER     = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as `0x${string}`
export const SEPOLIA_MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as `0x${string}`
export const SEPOLIA_RPC           = 'https://rpc.ankr.com/eth_sepolia'
export const SEPOLIA_RPC_BACKUP    = 'https://ethereum-sepolia-rpc.publicnode.com'
export const SEPOLIA_RPC_FALLBACK3 = 'https://sepolia.drpc.org'
export const SEPOLIA_RPC_BACKUP2   = SEPOLIA_RPC_FALLBACK3  // alias backward compat
export const SEPOLIA_CCTP_DOMAIN   = 0

// ─── CCTP V2 ──────────────────────────────────────────────────────────────────
export const ARC_CCTP_DOMAIN  = 26       // Arc Testnet domain
export const CCTP_MAX_FEE     = 1_000n   // 0.001 USDC (6 decimals)
export const CCTP_MIN_BRIDGE  = 0.002    // minimum amount dalam USDC

// ─── Iris API (Circle attestation) ───────────────────────────────────────────
export const IRIS_API = 'https://iris-api-sandbox.circle.com'

// ─── Helper: explorer URL per chain ──────────────────────────────────────────
export function getExplorerTxUrl(chainId: number, txHash: string): string {
  if (chainId === ARC_CHAIN_ID) return `${ARC_EXPLORER}/tx/${txHash}`
  return `${SEPOLIA_EXPLORER}/tx/${txHash}`
}

// ─── viem Public Clients ──────────────────────────────────────────────────────
export function makeArcPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: fallback(ARC_RPC_URLS.map(url => http(url))),
  })
}

export function makeSepoliaPublicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: fallback([
      http(SEPOLIA_RPC),
      http(SEPOLIA_RPC_BACKUP),
      http(SEPOLIA_RPC_FALLBACK3),
    ]),
  })
}
