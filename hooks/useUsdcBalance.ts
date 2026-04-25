/**
 * hooks/useUsdcBalance.ts
 * Baca USDC balance via viem langsung — tidak bergantung BridgeKit.
 * Auto-refresh 15 detik, pause saat tab tidak aktif.
 *
 * FIX v4: hapus BridgeKit dependency (usdc.balanceOf tidak ada di v1.8.x),
 * pakai readBalanceViem langsung — lebih reliable dan selalu tampil.
 * Parameter _adapter dipertahankan untuk backward compat.
 */
'use client'
import { useState, useEffect, useCallback } from 'react'
import { createPublicClient, http, fallback, formatUnits, erc20Abi } from 'viem'
import { sepolia } from 'viem/chains'
import {
  CHAIN_ARC, CHAIN_SEPOLIA,
  ARC_USDC, SEPOLIA_USDC,
  ARC_RPC_URLS, arcTestnet,
  SEPOLIA_RPC, SEPOLIA_RPC_BACKUP, SEPOLIA_RPC_FALLBACK3,
} from '@/lib/arcChain'

export interface UsdcBalances {
  arc:     string
  sepolia: string
  loading: boolean
  refresh: () => void
}

function fmt(val: string | number | bigint): string {
  const n = typeof val === 'bigint'
    ? parseFloat(formatUnits(val, 6))
    : typeof val === 'string' ? parseFloat(val) : val
  if (isNaN(n)) return '0.000000'
  return n.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })
}

async function readBalanceViem(chain: string, address: string): Promise<string> {
  try {
    const isArc = chain === CHAIN_ARC
    const client = isArc
      ? createPublicClient({
          chain: arcTestnet,
          transport: fallback(ARC_RPC_URLS.map(u => http(u))),
        })
      : createPublicClient({
          chain: sepolia,
          transport: fallback([
            http(SEPOLIA_RPC),
            http(SEPOLIA_RPC_BACKUP),
            http(SEPOLIA_RPC_FALLBACK3),
          ]),
        })
    const raw = await (client as any).readContract({
      address:      isArc ? ARC_USDC : SEPOLIA_USDC,
      abi:          erc20Abi,
      functionName: 'balanceOf',
      args:         [address as `0x${string}`],
    })
    return fmt(raw as bigint)
  } catch {
    return '0.000000'
  }
}

export function useUsdcBalance(_adapter: any | null, address: string | null): UsdcBalances {
  const [arc,      setArc]     = useState('0.000000')
  const [sepoliaB, setSepolia] = useState('0.000000')
  const [loading,  setLoading] = useState(false)

  // Reset saat address berubah
  useEffect(() => {
    setArc('0.000000')
    setSepolia('0.000000')
  }, [address])

  const refresh = useCallback(async () => {
    if (!address) return
    if (typeof document !== 'undefined' && document.hidden) return
    setLoading(true)
    try {
      const [a, s] = await Promise.all([
        readBalanceViem(CHAIN_ARC, address),
        readBalanceViem(CHAIN_SEPOLIA, address),
      ])
      setArc(a)
      setSepolia(s)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [address])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 15_000)
    return () => clearInterval(id)
  }, [refresh])

  return { arc, sepolia: sepoliaB, loading, refresh }
}
