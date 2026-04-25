/**
 * lib/arcChain.ts
 * Chain definition dan semua konstanta untuk Arc Testnet & Ethereum Sepolia.
 * Sumber: https://docs.arc.network/arc/references/contract-addresses
 */
import { createPublicClient, http, fallback } from 'viem'
import { sepolia } from 'viem/chains'

// ─── BridgeKit Chain Identifiers ───────────────────────────────────────────
// Format string exact yang dipakai @circle-fin/bridge-kit
// Ref: https://docs.arc.network/app-kit/bridge
export const BRIDGE_KIT_CHAIN_ARC     = 'Arc_Testnet'      as const
export const BRIDGE_KIT_CHAIN_SEPOLIA = 'Ethereum_Sepolia'  as const

// ─── Arc Testnet ───────────────────────────────────────────────────────────
export const ARC_CHAIN_ID     = 5042002
export const ARC_CHAIN_ID_HEX = '0x4cef52'
export const ARC_RPC          = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'
export const ARC_RPC_BACKUP   = 'https://rpc.blockdaemon.testnet.arc.network'
export const ARC_RPC_BACKUP2  = 'https://rpc.drpc.testnet.arc.network'
export const ARC_EXPLORER     = 'https://testnet.arcscan.app'
export const ARC_FAUCET       = 'https://faucet.circle.com'

export const arcTestnet = {
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: [ARC_RPC] },
    public:  { http: [ARC_RPC] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: ARC_EXPLORER },
  },
} as const

// ─── Arc Contract Addresses ────────────────────────────────────────────────
/** USDC native token di Arc — 6 decimals via ERC-20 interface */
export const ARC_USDC = '0x3600000000000000000000000000000000000000' as const
/** EURC — euro stablecoin, 6 decimals */
export const ARC_EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const
/** USYC — yield-bearing token, 6 decimals */
export const ARC_USYC = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C' as const
/** StableFX escrow */
export const ARC_FX_ESCROW = '0x867650F5eAe8df91445971f14d89fd84F0C9a9f8' as const
/** Multicall3 */
export const ARC_MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const
/** Permit2 */
export const ARC_PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const
export const ARC_TOKEN_MESSENGER = (
  process.env.NEXT_PUBLIC_ARC_TOKEN_MESSENGER ?? '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
) as `0x${string}`
export const ARC_MESSAGE_TRANSMITTER = (
  process.env.NEXT_PUBLIC_ARC_MESSAGE_TRANSMITTER ?? '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
) as `0x${string}`
export const ARC_GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const

// ─── CCTP V2 — Arc domain ──────────────────────────────────────────────────
export const ARC_CCTP_DOMAIN = 26

// ─── Ethereum Sepolia ──────────────────────────────────────────────────────
export const SEPOLIA_CHAIN_ID      = 11155111
export const SEPOLIA_CHAIN_ID_HEX  = '0xaa36a7'
export const SEPOLIA_RPC           = 'https://rpc.ankr.com/eth_sepolia'
export const SEPOLIA_RPC_BACKUP    = 'https://ethereum-sepolia-rpc.publicnode.com'
export const SEPOLIA_RPC_FALLBACK3 = 'https://sepolia.drpc.org'
export const SEPOLIA_EXPLORER      = 'https://sepolia.etherscan.io'
export const SEPOLIA_USDC          = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const
export const SEPOLIA_TOKEN_MESSENGER     = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as const
export const SEPOLIA_MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as const
export const SEPOLIA_CCTP_DOMAIN   = 0

// ─── CCTP V2 Constants ─────────────────────────────────────────────────────
/** Fast Transfer threshold — 1000 = instan di testnet */
export const CCTP_FAST_FINALITY = 1000
/**
 * maxFee untuk depositForBurn = 0.001 USDC (1000 units, 6 decimals)
 * PENTING: amount harus > maxFee, minimum bridge = 0.002 USDC
 */
export const CCTP_MAX_FEE = 1_000n

// ─── Iris API ──────────────────────────────────────────────────────────────
/** URL Iris API — polling dilakukan dari browser, bukan server */
export const IRIS_API = 'https://iris-api-sandbox.circle.com'

// ─── viem Client Helpers ───────────────────────────────────────────────────
export function makeArcPublicClient() {
  return createPublicClient({
    chain: arcTestnet as any,
    transport: fallback([
      http(ARC_RPC),
      http(ARC_RPC_BACKUP),
      http(ARC_RPC_BACKUP2),
    ]),
  }) as any
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
