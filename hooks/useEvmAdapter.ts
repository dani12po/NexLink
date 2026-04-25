/**
 * hooks/useEvmAdapter.ts
 * Buat ViemAdapter dari window.ethereum (WalletButton) atau wagmi connector.
 *
 * Karena kita pakai WalletButton custom (window.ethereum langsung),
 * useConnectorClient() biasanya return undefined — fallback ke getEvmProvider().
 */
'use client'
import { useEffect, useRef, useState } from 'react'
import { useConnectorClient } from 'wagmi'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { ViemAdapter } from '@circle-fin/adapter-viem-v2'
import { useWallet } from '@/components/WalletButton'
import { getEvmProvider } from '@/lib/evmProvider'

export function useEvmAdapter() {
  const { data: client }           = useConnectorClient()
  const { address: walletAddress } = useWallet()
  const [adapter, setAdapter]      = useState<ViemAdapter | null>(null)
  const prevProviderRef            = useRef<any>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!walletAddress) {
        if (!cancelled) { setAdapter(null); prevProviderRef.current = null }
        return
      }

      // Urutan: wagmi connector → window.ethereum
      const provider =
        (client as any)?.transport?.value?.provider ??
        (client as any)?.provider ??
        getEvmProvider()

      if (!provider) { if (!cancelled) setAdapter(null); return }
      if (provider === prevProviderRef.current) return

      try {
        const newAdapter = await createViemAdapterFromProvider({ provider })
        if (!cancelled) {
          setAdapter(newAdapter)
          prevProviderRef.current = provider
          if (process.env.NODE_ENV === 'development') {
            console.log('[useEvmAdapter] adapter ready, source:',
              provider === getEvmProvider() ? 'window.ethereum' : 'wagmi connector')
          }
        }
      } catch (e) {
        if (!cancelled) {
          setAdapter(null)
          if (process.env.NODE_ENV === 'development') {
            console.warn('[useEvmAdapter] createViemAdapterFromProvider gagal:', e)
          }
        }
      }
    })()
    return () => { cancelled = true }
  }, [client, walletAddress])

  return { evmAdapter: adapter, evmAddress: walletAddress ?? null }
}
