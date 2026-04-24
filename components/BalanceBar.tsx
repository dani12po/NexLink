/**
 * components/BalanceBar.tsx
 * Menampilkan USDC balance real-time di Arc Testnet
 */
'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createPublicClient, http, formatUnits, erc20Abi } from 'viem'
import { ARC_USDC, ARC_RPC, ARC_CHAIN_ID, arcTestnet } from '@/lib/arcChain'
import { useWallet } from './WalletButton'

const arcClient = createPublicClient({
  chain: arcTestnet as any,
  transport: http(ARC_RPC),
}) as any

export default function BalanceBar() {
  const { address, chainId, connected } = useWallet()
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchBalance = useCallback(async () => {
    if (!address) { setUsdcBalance(null); return }
    setLoading(true)
    try {
      const raw = await arcClient.readContract({
        address: ARC_USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      })
      setUsdcBalance(formatUnits(raw, 6))
    } catch {
      setUsdcBalance(null)
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    fetchBalance()
    const interval = setInterval(fetchBalance, 15000)
    return () => clearInterval(interval)
  }, [fetchBalance])

  const isArc = chainId === ARC_CHAIN_ID

  if (!connected) return null

  return (
    <div className="border-b border-zinc-800 bg-zinc-950/60">
      <div className="mx-auto max-w-6xl px-4 py-2 flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-4">
          {/* Network indicator */}
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isArc ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className="text-zinc-400">
              {isArc ? 'Arc Testnet' : chainId === 11155111 ? 'Sepolia' : `Chain ${chainId}`}
            </span>
          </div>

          {/* USDC Balance on Arc */}
          <div className="flex items-center gap-1.5 text-zinc-400">
            <span>Arc USDC:</span>
            {loading ? (
              <span className="text-zinc-600">…</span>
            ) : usdcBalance !== null ? (
              <span className="text-zinc-200 font-mono font-medium">
                {parseFloat(usdcBalance).toFixed(4)} USDC
              </span>
            ) : (
              <span className="text-zinc-600">—</span>
            )}
            <button
              type="button"
              onClick={fetchBalance}
              className="text-zinc-600 hover:text-zinc-400 transition-colors ml-1"
              title="Refresh balance"
            >
              ↻
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-zinc-600">
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-zinc-400 transition-colors"
          >
            Get testnet USDC ↗
          </a>
        </div>
      </div>
    </div>
  )
}
