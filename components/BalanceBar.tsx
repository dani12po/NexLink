/**
 * components/BalanceBar.tsx
 * Tampilkan USDC balance Arc + Sepolia secara parallel.
 * Auto-refresh 15 detik via useUsdcBalance.
 */
'use client'

import React from 'react'
import { ARC_CHAIN_ID } from '@/lib/arcChain'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import { useWallet }      from './WalletButton'

function Shimmer() {
  return <span className="inline-block w-20 h-3 rounded bg-zinc-800 animate-pulse" />
}

export default function BalanceBar() {
  const { address, chainId, connected } = useWallet()
  const { arc, sepolia, loading, refresh } = useUsdcBalance(null, address)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => { setMounted(true) }, [])

  // Jangan render apapun saat SSR — hindari hydration mismatch
  if (!mounted || !connected) return null

  const isArc = chainId === ARC_CHAIN_ID

  return (
    <div className="border-b border-zinc-800 bg-zinc-950/60">
      <div className="mx-auto max-w-6xl px-4 py-2 flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Network indicator */}
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isArc ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className="text-zinc-400">
              {isArc ? 'Arc Testnet' : chainId === 11155111 ? 'Sepolia' : `Chain ${chainId}`}
            </span>
          </div>

          {/* Arc balance */}
          <div className="flex items-center gap-1.5 text-zinc-400">
            <span>Arc:</span>
            {loading ? <Shimmer /> : <span className="text-zinc-200 font-mono font-medium">{arc} USDC</span>}
          </div>

          {/* Sepolia balance */}
          <div className="flex items-center gap-1.5 text-zinc-400">
            <span>Sepolia:</span>
            {loading ? <Shimmer /> : <span className="text-zinc-200 font-mono font-medium">{sepolia} USDC</span>}
          </div>

          <button
            type="button"
            onClick={refresh}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
            title="Refresh balance"
          >
            ↻
          </button>
        </div>

        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Get testnet USDC ↗
        </a>
      </div>
    </div>
  )
}
