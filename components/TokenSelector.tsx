/**
 * components/TokenSelector.tsx
 * Modal untuk memilih token swap
 */
'use client'

import React, { useState } from 'react'
import { SUPPORTED_TOKENS, type TokenSymbol } from '@/lib/swapTokens'

interface TokenSelectorProps {
  selected: TokenSymbol
  exclude?: TokenSymbol
  balances?: Record<string, string>
  onSelect: (token: TokenSymbol) => void
  onClose: () => void
}

export default function TokenSelector({
  selected, exclude, balances = {}, onSelect, onClose,
}: TokenSelectorProps) {
  const [search, setSearch] = useState('')

  const filtered = SUPPORTED_TOKENS.filter(t => {
    if (t.symbol === exclude) return false
    if (!search) return true
    return (
      t.symbol.toLowerCase().includes(search.toLowerCase()) ||
      t.name.toLowerCase().includes(search.toLowerCase())
    )
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-100">Pilih Token</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-zinc-800">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cari nama atau simbol token…"
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-zinc-700 bg-black/30 text-sm text-zinc-200 outline-none focus:border-zinc-500 placeholder:text-zinc-600"
          />
        </div>

        {/* Token list */}
        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-zinc-600 py-8">Token tidak ditemukan</p>
          ) : (
            filtered.map(token => (
              <button
                key={token.symbol}
                type="button"
                onClick={() => { onSelect(token.symbol); onClose() }}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/60 transition-colors text-left ${
                  token.symbol === selected ? 'bg-zinc-800/40' : ''
                }`}
              >
                {/* Logo char */}
                <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-lg flex-shrink-0">
                  {token.logoChar}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-100">{token.symbol}</span>
                    {token.symbol === selected && (
                      <span className="text-xs text-emerald-400">✓</span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">{token.name}</div>
                </div>

                {/* Balance */}
                {balances[token.symbol] && balances[token.symbol] !== '—' && (
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-zinc-300">{balances[token.symbol]}</div>
                    <div className="text-xs text-zinc-600">{token.symbol}</div>
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-800 text-xs text-zinc-600 text-center">
          Token tersedia di Arc Testnet •{' '}
          <a
            href="https://docs.arc.network/arc/references/contract-addresses"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-zinc-400"
          >
            Lihat semua
          </a>
        </div>
      </div>
    </div>
  )
}
