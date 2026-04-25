/**
 * lib/wagmiConfig.ts
 * Wagmi config — Arc Testnet + Ethereum Sepolia.
 *
 * TIDAK menggunakan wagmi/connectors karena re-export semua connector
 * (coinbaseWallet, baseAccount, dll) yang punya optional deps tidak terinstall.
 *
 * Wallet connection dihandle oleh WalletButton custom (window.ethereum langsung).
 * useEvmAdapter fallback ke getEvmProvider() untuk membuat ViemAdapter.
 */
import { createConfig, http } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { arcTestnet, ARC_RPC, ARC_CHAIN_ID } from './arcChain'

export const wagmiConfig = createConfig({
  chains:     [arcTestnet, sepolia],
  transports: {
    [ARC_CHAIN_ID]: http(ARC_RPC),
    [sepolia.id]:   http('https://ethereum-sepolia-rpc.publicnode.com'),
  },
  ssr: true,
})
