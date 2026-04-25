/**
 * hooks/useEvmAdapter.ts
 * Buat ViemAdapter dari wallet provider yang sedang terkoneksi.
 * Adaptasi dari sample resmi Circle:
 * https://github.com/circlefin/circle-bridge-kit-transfer/blob/main/src/hooks/useEvmAdapter.ts
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { useAccount, useConnectorClient } from 'wagmi'
import { createViemAdapterFromProvider, type ViemAdapter } from '@circle-fin/adapter-viem-v2'

export function useEvmAdapter() {
  const { address }       = useAccount()
  const { data: client }  = useConnectorClient()
  const [adapter, setAdapter] = useState<ViemAdapter | null>(null)
  const lastProviderRef   = useRef<any>(null)

  /** Ambil EIP-1193 provider dari wagmi connector client atau window.ethereum */
  function pickProvider(): any | null {
    // Coba dari wagmi connector client dulu (lebih reliable)
    const provider = (client as any)?.transport?.value?.provider
    if (provider) return provider

    // Fallback ke window.ethereum
    const eth = (globalThis as any)?.ethereum
    if (!eth) return null

    // Multi-wallet: ambil provider pertama
    if (Array.isArray(eth.providers) && eth.providers.length > 0) return eth.providers[0]
    return eth
  }

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      // Wallet belum connect — reset adapter
      if (!address) {
        if (!cancelled) {
          setAdapter(null)
          lastProviderRef.current = null
        }
        return
      }

      const provider = pickProvider()
      if (!provider) {
        if (!cancelled) setAdapter(null)
        return
      }

      // Hanya rebuild adapter jika provider benar-benar berubah
      if (provider !== lastProviderRef.current) {
        try {
          const newAdapter = await createViemAdapterFromProvider({ provider })
          if (!cancelled) {
            setAdapter(newAdapter)
            lastProviderRef.current = provider
          }
        } catch (e) {
          console.error('[useEvmAdapter] createViemAdapterFromProvider gagal:', e)
          if (!cancelled) setAdapter(null)
        }
      }
    })()

    return () => { cancelled = true }
  }, [client, address])

  return {
    evmAdapter:  adapter,
    evmAddress:  address ?? null,
  }
}
