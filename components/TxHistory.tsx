/**
 * components/TxHistory.tsx
 * Transaction history — tracks bridge & swap txs from localStorage
 */
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { ARC_EXPLORER } from '@/lib/arcChain'
import { loadHistory, type TxRecord, type TxStatus } from '@/lib/txHistory'
import { useWallet } from './WalletButton'

function timeAgo(ms: number) {
  const diff = Math.floor((Date.now() - ms) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function maskTx(h?: string) {
  if (!h) return '—'
  return `${h.slice(0, 8)}…${h.slice(-6)}`
}

function StatusBadge({ status }: { status: TxStatus }) {
  const map: Record<TxStatus, { label: string; cls: string }> = {
    success:     { label: 'Success',     cls: 'bg-emerald-900/40 text-emerald-400 border-emerald-800/50' },
    pending:     { label: 'Pending',     cls: 'bg-amber-900/40  text-amber-400  border-amber-800/50'  },
    attestation: { label: 'Attesting',   cls: 'bg-sky-900/40    text-sky-400    border-sky-800/50'    },
    failed:      { label: 'Failed',      cls: 'bg-red-900/40    text-red-400    border-red-800/50'    },
  }
  const { label, cls } = map[status] ?? map.pending
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border font-medium ${cls}`}>
      {status === 'pending' || status === 'attestation' ? (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      ) : null}
      {label}
    </span>
  )
}

function TypeBadge({ type, direction }: { type: TxRecord['type']; direction?: string }) {
  if (type === 'bridge') {
    const label = direction === 'sepolia-to-arc' ? 'Bridge →Arc' : direction === 'arc-to-sepolia' ? 'Bridge →Sep' : 'Bridge'
    return <span className="px-2 py-0.5 rounded-md text-xs border bg-violet-900/30 text-violet-400 border-violet-800/50 font-medium">{label}</span>
  }
  return <span className="px-2 py-0.5 rounded-md text-xs border bg-sky-900/30 text-sky-400 border-sky-800/50 font-medium">Swap</span>
}

function BridgeTxRow({ tx }: { tx: TxRecord }) {
  const explorerBase = tx.direction === 'sepolia-to-arc' ? 'https://sepolia.etherscan.io' : ARC_EXPLORER
  const mintExplorer = tx.direction === 'sepolia-to-arc' ? ARC_EXPLORER : 'https://sepolia.etherscan.io'

  return (
    <div className="px-3 py-3 rounded-xl border border-zinc-800 bg-zinc-900/30 space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type="bridge" direction={tx.direction} />
          <StatusBadge status={tx.status} />
        </div>
        <span className="text-xs text-zinc-600 shrink-0">{timeAgo(tx.timestamp)}</span>
      </div>

      {/* Amount row */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-200 font-medium">
          {tx.amountSent} USDC
          {tx.amountReceived && tx.status === 'success' && (
            <span className="text-zinc-500 text-xs ml-1">→ {tx.amountReceived} USDC</span>
          )}
        </div>
        {tx.fee && tx.status === 'success' && (
          <span className="text-xs text-zinc-600">fee: {tx.fee} USDC</span>
        )}
      </div>

      {/* Tx links */}
      <div className="flex flex-wrap gap-3 text-xs">
        {tx.burnTx && (
          <a href={`${explorerBase}/tx/${tx.burnTx}`} target="_blank" rel="noreferrer"
            className="text-zinc-500 hover:text-zinc-300 font-mono transition-colors">
            Burn: {maskTx(tx.burnTx)} ↗
          </a>
        )}
        {tx.mintTx && (
          <a href={`${mintExplorer}/tx/${tx.mintTx}`} target="_blank" rel="noreferrer"
            className="text-emerald-500 hover:text-emerald-300 font-mono transition-colors">
            Mint: {maskTx(tx.mintTx)} ↗
          </a>
        )}
      </div>

      {tx.errorMsg && (
        <p className="text-xs text-red-400 break-words">{tx.errorMsg}</p>
      )}
    </div>
  )
}

function SwapTxRow({ tx }: { tx: TxRecord }) {
  return (
    <div className="px-3 py-3 rounded-xl border border-zinc-800 bg-zinc-900/30 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TypeBadge type="swap" />
          <StatusBadge status={tx.status} />
        </div>
        <span className="text-xs text-zinc-600 shrink-0">{timeAgo(tx.timestamp)}</span>
      </div>

      <div className="text-sm text-zinc-200 font-medium">
        {tx.fromAmount} {tx.fromToken}
        <span className="text-zinc-500 mx-1">→</span>
        {tx.toAmount} {tx.toToken}
      </div>

      {tx.txHash && (
        <a href={`${ARC_EXPLORER}/tx/${tx.txHash}`} target="_blank" rel="noreferrer"
          className="text-xs text-zinc-500 hover:text-zinc-300 font-mono transition-colors">
          Tx: {maskTx(tx.txHash)} ↗
        </a>
      )}

      {tx.errorMsg && (
        <p className="text-xs text-red-400 break-words">{tx.errorMsg}</p>
      )}
    </div>
  )
}

export default function TxHistory() {
  const { address } = useWallet()
  const [txs, setTxs] = useState<TxRecord[]>([])

  const refresh = useCallback(() => {
    if (!address) {
      setTxs([])
      return
    }
    // Load only this wallet's history
    const walletTxs = loadHistory(address)
    setTxs(walletTxs.slice(0, 20))
  }, [address])

  // Clear immediately when wallet disconnects
  useEffect(() => {
    if (!address) {
      setTxs([])
      return
    }
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [address, refresh])

  if (!address) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-300">Transaction History</h3>
        <button type="button" onClick={refresh}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
          ↻ Refresh
        </button>
      </div>

      {txs.length === 0 ? (
        <div className="text-center py-8 text-xs text-zinc-700">
          Belum ada transaksi bridge atau swap
        </div>
      ) : (
        <div className="space-y-2">
          {txs.map(tx =>
            tx.type === 'bridge'
              ? <BridgeTxRow key={tx.id} tx={tx} />
              : <SwapTxRow   key={tx.id} tx={tx} />
          )}
        </div>
      )}

      <div className="mt-3 text-center">
        <a href={`${ARC_EXPLORER}/address/${address}`} target="_blank" rel="noreferrer"
          className="text-xs text-zinc-600 hover:text-zinc-400 underline transition-colors">
          Lihat semua di ArcScan ↗
        </a>
      </div>
    </div>
  )
}
