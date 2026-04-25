/**
 * components/TxHistory.tsx
 * Transaction history dengan paginasi 10 baris.
 * Filter: All | Bridge | Swap
 */
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  loadHistory, getPage, getTotalPages, clearAllHistory,
  type TxRecord, type TxStatus,
} from '@/lib/txHistory'
import { ARC_EXPLORER } from '@/lib/arcChain'
import { useWallet } from './WalletButton'

type FilterTab = 'all' | 'bridge' | 'swap'

function timeAgo(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 1000)
  if (d < 60)    return `${d}s ago`
  if (d < 3600)  return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

function maskTx(h?: string): string {
  if (!h) return '—'
  return `${h.slice(0, 8)}…${h.slice(-6)}`
}

function StatusBadge({ status }: { status: TxStatus }) {
  const map: Record<TxStatus, { label: string; cls: string }> = {
    success: { label: 'Success', cls: 'bg-emerald-900/40 text-emerald-400 border-emerald-800/50' },
    pending: { label: 'Pending', cls: 'bg-amber-900/40  text-amber-400  border-amber-800/50'  },
    failed:  { label: 'Failed',  cls: 'bg-red-900/40    text-red-400    border-red-800/50'    },
  }
  const { label, cls } = map[status] ?? map.pending
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border font-medium ${cls}`}>
      {status === 'pending' && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {label}
    </span>
  )
}

function TypeBadge({ type, direction }: { type: TxRecord['type']; direction?: string }) {
  if (type === 'bridge') {
    const label = direction === 'sepolia-to-arc' ? 'Bridge →Arc' : direction === 'arc-to-sepolia' ? 'Bridge →Sep' : 'Bridge'
    return <span className="px-2 py-0.5 rounded-md text-xs border bg-violet-900/30 text-violet-400 border-violet-800/50 font-medium">{label}</span>
  }
  if (type === 'send') {
    return <span className="px-2 py-0.5 rounded-md text-xs border bg-purple-900/30 text-purple-400 border-purple-800/50 font-medium">Send</span>
  }
  return <span className="px-2 py-0.5 rounded-md text-xs border bg-sky-900/30 text-sky-400 border-sky-800/50 font-medium">Swap</span>
}

function TxRow({ tx }: { tx: TxRecord }) {
  const explorerBase = tx.direction === 'sepolia-to-arc' ? 'https://sepolia.etherscan.io' : ARC_EXPLORER
  const mintExplorer = tx.direction === 'sepolia-to-arc' ? ARC_EXPLORER : 'https://sepolia.etherscan.io'

  return (
    <div className="px-3 py-3 rounded-xl border border-zinc-800 bg-zinc-900/30 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={tx.type} direction={tx.direction} />
          <StatusBadge status={tx.status} />
        </div>
        <span className="text-xs text-zinc-600 shrink-0">{timeAgo(tx.timestamp)}</span>
      </div>

      <div className="text-sm text-zinc-200 font-medium">
        {tx.type === 'bridge' && `${tx.amountSent ?? '?'} USDC`}
        {tx.type === 'swap'   && `${tx.fromAmount ?? '?'} ${tx.fromToken} → ${tx.toAmount ?? '?'} ${tx.toToken}`}
        {tx.type === 'send'   && `${tx.fromAmount ?? '?'} USDC`}
      </div>

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
        {tx.txHash && !tx.burnTx && (
          <a href={`${ARC_EXPLORER}/tx/${tx.txHash}`} target="_blank" rel="noreferrer"
            className="text-zinc-500 hover:text-zinc-300 font-mono transition-colors">
            Tx: {maskTx(tx.txHash)} ↗
          </a>
        )}
      </div>

      {tx.errorMsg && <p className="text-xs text-red-400 break-words">{tx.errorMsg}</p>}
    </div>
  )
}

export default function TxHistory() {
  const { address } = useWallet()
  const [allRecords, setAllRecords] = useState<TxRecord[]>([])
  const [filter,     setFilter]     = useState<FilterTab>('all')
  const [page,       setPage]       = useState(1)

  const reload = useCallback(() => {
    setAllRecords(loadHistory(address))
  }, [address])

  useEffect(() => {
    reload()
    setPage(1)
  }, [address, reload])

  // Auto-refresh jika ada pending tx
  useEffect(() => {
    const hasPending = allRecords.some(r => r.status === 'pending')
    if (!hasPending) return
    const id = setInterval(reload, 30_000)
    return () => clearInterval(id)
  }, [allRecords, reload])

  useEffect(() => { setPage(1) }, [filter])

  const filtered   = filter === 'all' ? allRecords : allRecords.filter(r => r.type === filter)
  const totalPages = getTotalPages(filtered)
  const pageItems  = getPage(filtered, page)

  function handleClear() {
    if (!address) return
    if (!confirm('Hapus semua riwayat transaksi?')) return
    clearAllHistory(address)
    setAllRecords([])
    setPage(1)
  }

  if (!address) {
    return (
      <div className="text-center py-8 text-xs text-zinc-600">
        Connect wallet untuk melihat riwayat transaksi
      </div>
    )
  }

  const TAB = (t: FilterTab, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(t)}
      className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
        filter === t
          ? 'border-zinc-600 bg-zinc-800 text-zinc-200'
          : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-300">Transaction History</h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={reload}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
            ↻
          </button>
          {allRecords.length > 0 && (
            <button type="button" onClick={handleClear}
              className="text-xs text-red-600 hover:text-red-400 transition-colors">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-3">
        {TAB('all',    'All')}
        {TAB('bridge', 'Bridge')}
        {TAB('swap',   'Swap')}
      </div>

      {/* List */}
      {pageItems.length === 0 ? (
        <div className="text-center py-8 text-xs text-zinc-700">
          {filter === 'all' ? 'Belum ada transaksi' : `Belum ada transaksi ${filter}`}
        </div>
      ) : (
        <div className="space-y-2">
          {pageItems.map(tx => <TxRow key={tx.id} tx={tx} />)}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ◀
          </button>
          <span className="text-xs text-zinc-500">
            Halaman {page} dari {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ▶
          </button>
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
