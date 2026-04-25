/**
 * hooks/useUsdcBalance.ts
 * Baca balance USDC via BridgeKit adapter.
 * Adaptasi dari sample resmi Circle:
 * https://github.com/circlefin/circle-bridge-kit-transfer/blob/main/src/hooks/useUsdcBalance.ts
 */
'use client'

import { useState, useCallback, useEffect } from 'react'
import { formatUnits } from 'viem'
import type { ViemAdapter } from '@circle-fin/adapter-viem-v2'

export function useUsdcBalance(
  evmAdapter:  ViemAdapter | null,
  evmAddress:  string | null,
  chain:       string,  // 'Arc_Testnet' atau 'Ethereum_Sepolia'
) {
  const [balance, setBalance] = useState<string>('—')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!evmAdapter || !evmAddress) {
      setBalance('—')
      return
    }
    setLoading(true)
    try {
      // Baca balance via BridgeKit adapter
      // Ref: sample resmi Circle src/hooks/useUsdcBalance.ts
      const action = await evmAdapter.prepareAction(
        'usdc.balanceOf',
        {},
        { chain, address: evmAddress } as any,
      )
      const rawBalance = await action.execute()
      // USDC = 6 decimals
      setBalance(parseFloat(formatUnits(BigInt(rawBalance as string), 6)).toFixed(4))
    } catch {
      // Fallback: tampilkan '—' jika gagal
      setBalance('—')
    } finally {
      setLoading(false)
    }
  }, [evmAdapter, evmAddress, chain])

  // Fetch saat adapter/address/chain berubah
  useEffect(() => { refresh() }, [refresh])

  // Auto-refresh setiap 30 detik
  useEffect(() => {
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [refresh])

  return { balance, loading, refresh }
}
