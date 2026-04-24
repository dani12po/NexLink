/**
 * lib/appKitAdapter.ts
 * Browser wallet adapter untuk Arc App Kit
 * Ref: https://arc-docs.mintlify.app/app-kit/tutorials/adapter-setups
 */
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { getEvmProvider } from './evmProvider'

let _adapter: any = null

export async function getBrowserAdapter() {
  if (_adapter) return _adapter
  const provider = getEvmProvider()
  if (!provider) throw new Error('No EVM wallet found. Install MetaMask or OKX Wallet.')
  _adapter = await createViemAdapterFromProvider({ provider })
  return _adapter
}

export function resetAdapter() {
  _adapter = null
}
