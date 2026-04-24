/**
 * lib/walletAdapter.ts
 * Bridge antara browser wallet (MetaMask, OKX, Rabby, dll) dan Circle App Kit
 * Ref: https://arc-docs.mintlify.app/app-kit/tutorials/adapter-setups
 */
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { getEvmProvider } from './evmProvider'

/**
 * Buat App Kit adapter dari browser wallet yang aktif.
 * Selalu buat instance baru agar reflect state wallet terkini.
 */
export async function createBrowserAdapter() {
  const provider = getEvmProvider()
  if (!provider) throw new Error('No wallet provider found. Install MetaMask or OKX Wallet.')
  return createViemAdapterFromProvider({ provider })
}
