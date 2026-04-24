/**
 * components/SlippageSettings.tsx
 * Komponen pengaturan slippage tolerance
 */
'use client'

import React from 'react'
import { getSlippageWarning } from '@/lib/swapTokens'

interface SlippageSettingsProps {
  value: string
  onChange: (v: string) => void
  onClose: () => void
}

const PRESETS = ['0.1', '0.5', '1.0']

export default function SlippageSettings({ value, onChange, onClose }: SlippageSettingsProps) {
  const numVal = parseFloat(value) || 0
  const { showWarning } = getSlippageWarning(numVal)

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">Slippage Tolerance</span>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-xs"
          aria-label="Tutup slippage settings"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-2">
        {PRESETS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              value === p
                ? 'border-emerald-700 bg-emerald-500/10 text-emerald-300'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            {p}%
          </button>
        ))}
        <div className="flex-1 relative">
          <input
            type="number"
            min="0.01"
            max="50"
            step="0.1"
            value={PRESETS.includes(value) ? '' : value}
            onChange={e => onChange(e.target.value)}
            placeholder="Custom"
            className="w-full px-2 py-1.5 rounded-lg border border-zinc-700 bg-black/30 text-xs text-zinc-200 outline-none focus:border-zinc-500 text-center"
          />
        </div>
      </div>

      {showWarning && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-800/50 bg-amber-500/5 text-xs text-amber-400">
          <span>⚠️</span>
          <span>Slippage tinggi ({value}%). Transaksi mungkin di-frontrun. Gunakan ≤ 5% untuk keamanan.</span>
        </div>
      )}

      <p className="text-xs text-zinc-600">
        Transaksi akan dibatalkan jika harga berubah lebih dari {value}% dari quote.
      </p>
    </div>
  )
}
