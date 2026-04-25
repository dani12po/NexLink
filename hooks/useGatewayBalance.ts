/**
 * hooks/useGatewayBalance.ts
 * Ambil unified USDC balance via Circle Gateway.
 * Ref: https://developers.circle.com/api-reference/gateway
 */
'use client'

import { useState, useCallback, useEffect } from 'react'
import { getGatewayBalances, type GatewayBalance } from '@/lib/gateway'

export function useGatewayBalance(walletAddress: string | null) {
  const [balances, setBalances] = useState<GatewayBalance[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!walletAddress) { setBalances([]); return }
    setLoading(true)
    setError(null)
    try {
      const data = await getGatewayBalances(walletAddress)
      setBalances(data)
    } catch (e: any) {
      setError(e?.message ?? 'Gagal ambil Gateway balance')
    } finally {
      setLoading(false)
    }
  }, [walletAddress])

  useEffect(() => { refresh() }, [refresh])

  /** Ambil balance untuk chain tertentu */
  function getBalance(chain: string): string | null {
    const b = balances.find(b => b.chain?.toLowerCase() === chain.toLowerCase())
    return b?.amount ?? null
  }

  return { balances, loading, error, refresh, getBalance }
}
