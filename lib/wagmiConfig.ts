/**
 * lib/wagmiConfig.ts
 * Wagmi config untuk Arc Testnet + Sepolia
 *
 * NOTE: wagmi/viem requires nativeCurrency.decimals = 18 for chain validation.
 * Arc Testnet's USDC is actually 6 decimals — use ARC_USDC (6 dec) for all
 * ERC-20 contract calls. The 18 here is only to satisfy wagmi's type constraint.
 */
import { createConfig, http } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { ARC_CHAIN_ID, ARC_RPC, ARC_EXPLORER } from './arcChain'
import { defineChain } from 'viem'

export const arcTestnetChain = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  // wagmi requires decimals: 18 — actual USDC decimals (6) are used in contract calls
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC] },
    public: { http: [ARC_RPC] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: ARC_EXPLORER },
  },
})

export const wagmiConfig = createConfig({
  chains: [arcTestnetChain, sepolia],
  transports: {
    [ARC_CHAIN_ID]: http(ARC_RPC),
    [sepolia.id]: http('https://ethereum-sepolia-rpc.publicnode.com'),
  },
})
