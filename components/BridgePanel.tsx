/**
 * components/BridgePanel.tsx
 * Bridge USDC: Ethereum Sepolia ↔ Arc Testnet via @circle-fin/bridge-kit.
 *
 * BridgeKit mengelola seluruh CCTP V2 flow secara internal:
 * - Approve → Burn → Poll Iris (dari browser, tidak kena IP block) → Mint
 *
 * Ref: https://docs.arc.network/app-kit/bridge
 * Sample: https://github.com/circlefin/circle-bridge-kit-transfer
 */
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useSwitchChain } from 'wagmi'
import {
  BRIDGE_KIT_CHAIN_ARC, BRIDGE_KIT_CHAIN_SEPOLIA,
  ARC_EXPLORER, SEPOLIA_EXPLORER,
} from '@/lib/arcChain'
import { useEvmAdapter }   from '@/hooks/useEvmAdapter'
import { useBridge }       from '@/hooks/useBridge'
import { useProgress, type BridgeStep } from '@/hooks/useProgress'
import { useUsdcBalance }  from '@/hooks/useUsdcBalance'
import { useWallet }       from './WalletButton'

/* ── Types ────────────────────────────────────────────────────────────── */
interface SupportedChain {
  chain:      string
  chainId?:   number
  name:       string
  isTestnet?: boolean
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
function maskTx(h: string) { return h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '' }

function explorerUrl(chain: string, txHash: string): string {
  if (chain === BRIDGE_KIT_CHAIN_ARC) return `${ARC_EXPLORER}/tx/${txHash}`
  return `${SEPOLIA_EXPLORER}/tx/${txHash}`
}

/* ── Step Indicator ───────────────────────────────────────────────────── */
const STEPS: { key: BridgeStep; label: string }[] = [
  { key: 'approving',           label: 'Approve' },
  { key: 'burning',             label: 'Burn' },
  { key: 'waiting-attestation', label: 'Attestation' },
  { key: 'minting',             label: 'Mint' },
]

function StepIndicator({ current }: { current: BridgeStep }) {
  const order: BridgeStep[] = ['approving', 'burning', 'waiting-attestation', 'minting', 'completed']
  const curIdx = order.indexOf(current)

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => {
        const idx    = order.indexOf(s.key)
        const done   = curIdx > idx || current === 'completed'
        const active = curIdx === idx && current !== 'completed' && current !== 'error'
        const err    = current === 'error' && curIdx === idx

        return (
          <React.Fragment key={s.key}>
            <div className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-colors ${
                done   ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' :
                active ? 'bg-amber-500/20 border-amber-500 text-amber-300 animate-pulse' :
                err    ? 'bg-red-500/20 border-red-500 text-red-400' :
                         'bg-zinc-900 border-zinc-700 text-zinc-600'
              }`}>
                {done ? '✓' : err ? '✗' : i + 1}
              </div>
              <span className={`text-xs ${active ? 'text-amber-300' : done ? 'text-emerald-400' : 'text-zinc-600'}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mb-5 transition-colors ${done ? 'bg-emerald-500/40' : 'bg-zinc-800'}`} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

/* ── Main Component ───────────────────────────────────────────────────── */
export default function BridgePanel() {
  const { evmAdapter, evmAddress: wagmiAddress } = useEvmAdapter()
  // Pakai address dari WalletButton (custom hook) sebagai primary
  // karena wallet connect via window.ethereum, bukan wagmi
  const { address: walletAddress } = useWallet()
  const evmAddress = walletAddress || wagmiAddress

  const { bridge, retry, estimate, isLoading, error, result, clear } = useBridge()
  const { currentStep, setCurrentStep, stepLabel, logs, handleEvent, reset: resetProgress } = useProgress()
  const { switchChainAsync } = useSwitchChain()

  const [sourceChain,      setSourceChain]      = useState<string>(BRIDGE_KIT_CHAIN_SEPOLIA)
  const [destinationChain, setDestinationChain] = useState<string>(BRIDGE_KIT_CHAIN_ARC)
  const [amount,           setAmount]           = useState('')
  const [recipient,        setRecipient]        = useState('')
  const [useRecipient,     setUseRecipient]     = useState(false)
  // Hanya 2 chain yang didukung — Arc Testnet ↔ Ethereum Sepolia
  const availableChains: SupportedChain[] = [
    { chain: BRIDGE_KIT_CHAIN_SEPOLIA, name: 'Ethereum Sepolia', chainId: 11155111, isTestnet: true },
    { chain: BRIDGE_KIT_CHAIN_ARC,     name: 'Arc Testnet',      chainId: 5042002,  isTestnet: true },
  ]
  const [feeEstimate,      setFeeEstimate]      = useState<string | null>(null)
  const [fetchingFee,      setFetchingFee]      = useState(false)

  // Balance di source chain
  const { balance: srcBalance, refresh: refreshSrcBalance } = useUsdcBalance(
    evmAdapter, evmAddress, sourceChain,
  )
  // Balance di destination chain
  const { balance: dstBalance, refresh: refreshDstBalance } = useUsdcBalance(
    evmAdapter, evmAddress, destinationChain,
  )

  const isBusy = isLoading
  const isDone = currentStep === 'completed'
  const isErr  = currentStep === 'error' || !!error

  /* ── Estimasi fee saat amount berubah ─────────────────────────────── */
  useEffect(() => {
    const amt = parseFloat(amount)
    if (!evmAdapter || !amount || isNaN(amt) || amt <= 0) {
      setFeeEstimate(null)
      return
    }
    const timer = setTimeout(async () => {
      setFetchingFee(true)
      try {
        const est = await estimate({
          fromChain: sourceChain, toChain: destinationChain,
          amount, fromAdapter: evmAdapter, toAdapter: evmAdapter,
        }) as any
        // est.fee dalam USDC units atau string
        if (est?.fee) setFeeEstimate(String(est.fee))
      } catch { setFeeEstimate(null) }
      finally { setFetchingFee(false) }
    }, 600) // debounce 600ms
    return () => clearTimeout(timer)
  }, [amount, sourceChain, destinationChain, evmAdapter])

  /* ── Flip direction ───────────────────────────────────────────────── */
  function flipDirection() {
    if (isBusy) return
    setSourceChain(destinationChain)
    setDestinationChain(sourceChain)
    setAmount('')
    setFeeEstimate(null)
    clear()
    resetProgress()
  }

  /* ── Submit bridge ────────────────────────────────────────────────── */
  async function handleBridge() {
    if (!evmAddress) return

    const amt = parseFloat(amount)
    if (!amount || isNaN(amt) || amt <= 0.001) {
      alert('Jumlah minimum bridge adalah 0.002 USDC')
      return
    }

    // Jika adapter belum siap (wagmi belum sync), coba buat dari window.ethereum
    let adapter = evmAdapter
    if (!adapter) {
      try {
        const { createViemAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2')
        const { getEvmProvider } = await import('@/lib/evmProvider')
        const provider = getEvmProvider()
        if (provider) adapter = await createViemAdapterFromProvider({ provider })
      } catch { /* ignore */ }
    }
    if (!adapter) {
      alert('Wallet adapter tidak siap. Coba refresh halaman.')
      return
    }

    resetProgress()
    clear()
    // Tampilkan step indicator SEGERA — jangan tunggu event dari BridgeKit
    setCurrentStep('approving')

    try {
      // Switch wallet ke source chain jika perlu
      const srcChainObj = availableChains.find(c => c.chain === sourceChain)
      if (srcChainObj?.chainId && switchChainAsync) {
        try {
          await switchChainAsync({ chainId: srcChainObj.chainId })
        } catch { /* user mungkin sudah di chain yang benar */ }
      }

      await bridge(
        {
          fromChain:        sourceChain,
          toChain:          destinationChain,
          amount,
          fromAdapter:      adapter,
          toAdapter:        adapter,
          recipientAddress: useRecipient && recipient.trim() ? recipient.trim() : undefined,
        },
        { onEvent: handleEvent },
      )

      // Refresh balance setelah selesai
      await Promise.all([refreshSrcBalance(), refreshDstBalance()])
    } catch { /* error sudah di-handle di useBridge */ }
  }

  /* ── Retry ────────────────────────────────────────────────────────── */
  async function handleRetry() {
    if (!result) return
    let adapter = evmAdapter
    if (!adapter) {
      try {
        const { createViemAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2')
        const { getEvmProvider } = await import('@/lib/evmProvider')
        const provider = getEvmProvider()
        if (provider) adapter = await createViemAdapterFromProvider({ provider })
      } catch { return }
    }
    if (!adapter) return
    resetProgress()
    try {
      await retry(result, { fromAdapter: adapter, toAdapter: adapter }, { onEvent: handleEvent })
      await Promise.all([refreshSrcBalance(), refreshDstBalance()])
    } catch { /* error sudah di-handle */ }
  }

  /* ── Chain label helper ───────────────────────────────────────────── */
  function chainLabel(chain: string): string {
    return availableChains.find(c => c.chain === chain)?.name ?? chain
  }

  /* ── Render ───────────────────────────────────────────────────────── */
  return (
    <div className="space-y-5">

      {/* Direction selector */}
      <div className="flex items-center gap-2">
        {/* Source chain */}
        <select
          value={sourceChain}
          onChange={e => { if (!isBusy) { setSourceChain(e.target.value); clear(); resetProgress() } }}
          disabled={isBusy}
          className="flex-1 px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900/60 text-sm text-zinc-200 outline-none focus:border-zinc-600 disabled:opacity-50"
        >
          {availableChains.filter(c => c.chain !== destinationChain).map(c => (
            <option key={c.chain} value={c.chain}>{c.name}</option>
          ))}
        </select>

        {/* Flip button */}
        <button
          type="button" onClick={flipDirection} disabled={isBusy}
          className="w-9 h-9 rounded-full border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-all hover:rotate-180 duration-300 disabled:opacity-50"
          aria-label="Balik arah bridge"
        >↔</button>

        {/* Destination chain */}
        <select
          value={destinationChain}
          onChange={e => { if (!isBusy) { setDestinationChain(e.target.value); clear(); resetProgress() } }}
          disabled={isBusy}
          className="flex-1 px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900/60 text-sm text-zinc-200 outline-none focus:border-zinc-600 disabled:opacity-50"
        >
          {availableChains.filter(c => c.chain !== sourceChain).map(c => (
            <option key={c.chain} value={c.chain}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Balances */}
      {evmAddress && (
        <div className="flex items-center justify-between px-1 text-xs text-zinc-600">
          <span>{chainLabel(sourceChain)}: <span className="text-zinc-400">{srcBalance} USDC</span></span>
          <span>{chainLabel(destinationChain)}: <span className="text-zinc-400">{dstBalance} USDC</span></span>
        </div>
      )}

      {/* Amount */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">
          Jumlah USDC ({chainLabel(sourceChain)})
        </label>
        <input
          type="number" min="0.002" step="0.01" value={amount}
          onChange={e => { setAmount(e.target.value); setFeeEstimate(null) }}
          disabled={isBusy} placeholder="1.00"
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600 disabled:opacity-50"
        />
      </div>

      {/* Fee estimate dari BridgeKit */}
      {(feeEstimate || fetchingFee) && parseFloat(amount) > 0 && (
        <div className="px-3 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/20 space-y-1.5 text-xs">
          <div className="flex justify-between text-zinc-500">
            <span>Kamu kirim</span>
            <span className="text-zinc-300 font-medium">{amount} USDC</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>CCTP fee {fetchingFee && <span className="text-zinc-600">…</span>}</span>
            <span className="text-red-400">
              {fetchingFee ? '…' : feeEstimate ? `− ${feeEstimate} USDC` : '—'}
            </span>
          </div>
          {feeEstimate && !fetchingFee && (
            <div className="border-t border-zinc-800 pt-1.5 flex justify-between">
              <span className="text-zinc-400">Kamu terima (estimasi)</span>
              <span className="text-emerald-400 font-semibold">
                {Math.max(0, parseFloat(amount) - parseFloat(feeEstimate)).toFixed(6)} USDC
              </span>
            </div>
          )}
        </div>
      )}

      {/* Optional recipient */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox" checked={useRecipient}
            onChange={e => setUseRecipient(e.target.checked)}
            disabled={isBusy}
            className="rounded border-zinc-700 bg-zinc-900 text-emerald-500"
          />
          <span className="text-xs text-zinc-500">Kirim ke alamat berbeda</span>
        </label>
        {useRecipient && (
          <input
            type="text" value={recipient}
            onChange={e => setRecipient(e.target.value)}
            disabled={isBusy} placeholder="0x… recipient address"
            className="w-full px-3 py-2.5 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600 disabled:opacity-50"
          />
        )}
      </div>

      {/* Bridge button */}
      <button
        type="button" onClick={handleBridge}
        disabled={isBusy || !evmAddress || !amount || parseFloat(amount) <= 0.001}
        className="w-full py-3 rounded-xl border border-emerald-800 bg-emerald-500/10 hover:bg-emerald-500/15 hover:shadow-lg hover:shadow-emerald-500/30 text-sm font-semibold disabled:opacity-50 transition-all"
      >
        {isBusy ? stepLabel : isDone ? '✅ Bridge Selesai' : `Bridge ${amount || '?'} USDC →`}
      </button>

      {!evmAddress && (
        <p className="text-center text-xs text-zinc-600">Connect wallet untuk bridge</p>
      )}

      {/* Step indicator — tampil segera saat bridge dimulai */}
      {(currentStep !== 'idle' || isBusy) && (
        <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30 space-y-4">
          <StepIndicator current={currentStep} />

          {/* Log timeline */}
          {logs.length > 0 && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {logs.map((log, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-zinc-600 shrink-0 font-mono">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  <span className={
                    log.step === 'completed' ? 'text-emerald-400' :
                    log.step === 'error'     ? 'text-red-400' : 'text-zinc-400'
                  }>
                    {log.message}
                  </span>
                  {log.txHash && (
                    <a
                      href={explorerUrl(sourceChain, log.txHash)}
                      target="_blank" rel="noreferrer"
                      className="text-sky-500 hover:text-sky-400 shrink-0 font-mono"
                    >
                      {maskTx(log.txHash)}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Success */}
          {isDone && result && (
            <div className="space-y-2">
              <p className="text-xs text-emerald-400 font-medium">✅ Bridge berhasil!</p>
              {(result as any)?.mintTxHash && (
                <a
                  href={explorerUrl(destinationChain, (result as any).mintTxHash)}
                  target="_blank" rel="noreferrer"
                  className="block text-xs text-emerald-400 underline hover:text-emerald-300"
                >
                  Lihat mint tx di explorer →
                </a>
              )}
              <button
                type="button"
                onClick={() => { clear(); resetProgress(); setAmount('') }}
                className="text-xs text-zinc-500 hover:text-zinc-400 underline"
              >
                Bridge lagi
              </button>
            </div>
          )}

          {/* Error + retry */}
          {isErr && (
            <div className="space-y-2">
              <p className="text-xs text-red-400 break-all">❌ {error || 'Bridge gagal'}</p>
              {result && evmAdapter && (
                <button
                  type="button" onClick={handleRetry} disabled={isBusy}
                  className="w-full py-2 rounded-lg border border-amber-800 bg-amber-500/10 hover:bg-amber-500/15 text-xs font-medium text-amber-300 disabled:opacity-50 transition-colors"
                >
                  {isBusy ? '⏳ Mencoba ulang…' : '🔄 Retry Bridge'}
                </button>
              )}
              <button
                type="button"
                onClick={() => { clear(); resetProgress() }}
                className="text-xs text-zinc-500 hover:text-zinc-400 underline"
              >
                Mulai ulang
              </button>
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="text-xs text-zinc-700 space-y-0.5 pt-1">
        <p>• Bridge via Circle BridgeKit — attestation polling dari browser (tidak kena IP block)</p>
        <p>• Attestation bisa memakan waktu <b className="text-zinc-600">1–20 menit</b> (normal di testnet)</p>
        <p>• Arc Testnet otomatis ditambahkan ke wallet jika belum ada</p>
        <p>• Butuh USDC: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="underline hover:text-zinc-500">faucet.circle.com</a></p>
        <p>• Butuh ETH Sepolia untuk gas approve &amp; burn</p>
      </div>
    </div>
  )
}
