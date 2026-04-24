/**
 * lib/arcChain.ts
 * Arc Testnet chain definition & semua contract addresses resmi
 * Sumber: https://docs.arc.network/arc/references/connect-to-arc
 *         https://docs.arc.network/arc/references/contract-addresses
 */

// ─── Arc Testnet Network ───────────────────────────────────────────────────
// chainId 5042002 — sumber resmi: https://docs.arc.network/arc/references/connect-to-arc
export const ARC_CHAIN_ID     = 5042002
export const ARC_CHAIN_ID_HEX = '0x4cef52' // 5042002 in hex
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

// ─── Arc Testnet Contract Addresses ───────────────────────────────────────
// Sumber: https://docs.arc.network/arc/references/contract-addresses

/** USDC — native EVM asset on Arc, 6 decimals */
export const ARC_USDC = '0x3600000000000000000000000000000000000000' as const

/** EURC — euro stablecoin, 6 decimals */
export const ARC_EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const

/** USYC — yield-bearing token, 6 decimals */
export const ARC_USYC = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C' as const

/** Circle Gateway — GatewayWallet on Arc Testnet (domain 26) */
export const ARC_GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const

/** StableFX escrow */
export const ARC_FX_ESCROW = '0x867650F5eAe8df91445971f14d89fd84F0C9a9f8' as const

/** Multicall3 */
export const ARC_MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

/** Permit2 */
export const ARC_PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

// ─── CCTP V2 — Arc Testnet (domain 26) ────────────────────────────────────
export const ARC_CCTP_DOMAIN = 26
export const ARC_TOKEN_MESSENGER = (
  process.env.NEXT_PUBLIC_ARC_TOKEN_MESSENGER ?? '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
) as `0x${string}`
export const ARC_MESSAGE_TRANSMITTER = (
  process.env.NEXT_PUBLIC_ARC_MESSAGE_TRANSMITTER ?? '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
) as `0x${string}`

// ─── CCTP V2 — Ethereum Sepolia (domain 0) ────────────────────────────────
export const SEPOLIA_CHAIN_ID      = 11155111
export const SEPOLIA_CHAIN_ID_HEX  = '0xaa36a7'
export const SEPOLIA_RPC           = 'https://rpc.ankr.com/eth_sepolia'
export const SEPOLIA_RPC_BACKUP    = 'https://ethereum-sepolia-rpc.publicnode.com'
export const SEPOLIA_RPC_FALLBACK3 = 'https://sepolia.drpc.org'
export const SEPOLIA_USDC          = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const
export const SEPOLIA_TOKEN_MESSENGER     = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as const
export const SEPOLIA_MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as const
export const SEPOLIA_CCTP_DOMAIN   = 0

/**
 * minFinalityThreshold untuk depositForBurn:
 * 1000 = Fast Transfer (direkomendasikan Circle untuk testnet)
 * Berlaku untuk KEDUA arah: Sepolia→Arc dan Arc→Sepolia
 */
export const CCTP_FAST_FINALITY = 1000

/**
 * maxFee untuk depositForBurn (0.1 USDC = 100_000 units, 6 decimals)
 * Harus > 0 agar Circle Iris mau proses attestation
 */
export const CCTP_MAX_FEE = 100_000n

// ─── Typed viem client helpers ────────────────────────────────────────────
export function makeArcPublicClient() {
  const { createPublicClient, http } = require('viem')
  return createPublicClient({ chain: arcTestnet as any, transport: http(ARC_RPC) }) as any
}
