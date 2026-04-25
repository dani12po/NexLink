/**
 * components/BridgePanel.tsx
 * UI Bridge USDC: Ethereum Sepolia ↔ Arc Testnet via Circle CCTP V2.
 * Delegasi semua logic ke useBridge hook — komponen ini hanya UI.
 */
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPublicClient, http, fallback, formatUnits, erc20Abi, parseUnits } from 'viem'
import { sepolia } from 'viem/chains'
import {
  ARC_USDC, ARC_EXPLORER, ARC_RPC, ARC_RPC_BACKUP, ARC_RPC_BACKUP2, arcTestnet,
  SEPOLIA_USDC, SEPOLIA_RPC, SEPOLIA_RPC_BACKUP, SEPOLIA_RPC_FALLBACK3, SEPOLIA_EXPLORER,
} from '@/lib/arcChain'
import { estimateBridgeReceived, loadHistory, type TxRecord } from '@/lib/txHistory'
import { useBridge, type BridgeDirection, fetchCctpFee, fetchFastAllowance, type CctpFeeInfo } from '@/hooks/useBridge'
import { useWallet } from './WalletButton'
import { getEvmProvider, NO_WALLET_MSG } from '@/lib/evmProvider'

/* ── Helpers ──────────────────────────────────────────────────────────── */
function maskTx(h: string) { return h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '' }

function makeSepoliaClient() {
  return createPublicClient({
    chain: sepolia,
    transport: fallback([http(SEPOLIA_RPC), http(SEPOLIA_RPC_BACKUP), http(SEPOLIA_RPC_FALLBACK3)]),
  })
}
function makeArcClient() {
  return createPublicClient({
    chain: arcTestnet as any,
    transport: fallback([http(ARC_RPC), http(ARC_RPC_BACKUP), http(ARC_RPC_BACKUP2)]),
  }) as any
}

/* ── Sub-components ───────────────────────────────────────────────────── */
function StepRow({ num, label, status, detail }: {
  num: number; label: string
  status: 'idle' | 'active' | 'done' | 'error'; detail?: string
}) {
  const icon = status === 'done' ? '✅' : status === 'active' ? '⏳' : status === 'error' ? '❌' : '○'
  const cls  = status === 'done' ? 'text-emerald-400' : status === 'active' ? 'text-amber-300' : status === 'error' ? 'text-red-400' : 'text-zinc-600'
  return (
    <div className={`flex items-start gap-3 py-1.5 ${cls}`}>
      <span className="w-5 text-center shrink-0 text-sm">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm">{num}. {label}</div>
        {detail && <div className="text-xs opacity-60 mt-0.5 break-all font-mono">{detail}</div>}
      </div>
    </div>
  )
}

function TxHistoryRow({ tx }: { tx: TxRecord }) {
  const explorer = tx.direction === 'arc-to-sepolia' ? SEPOLIA_EXPLORER : ARC_EXPLORER
  const statusCls = tx.status === 'success' ? 'text-emerald-400' : tx.status === 'failed' ? 'text-red-400' : 'text-amber-300'
  return (
    <div className="flex items-center justify-between py-1.5 text-xs border-b border-zinc-800/50 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className={statusCls}>{tx.status === 'success' ? '✅' : tx.status === 'failed' ? '❌' : '⏳'}</span>
        <span className="text-zinc-400 truncate">
          {tx.direction === 'sepolia-to-arc' ? 'Sepolia→Arc' : 'Arc→Sepolia'} {tx.amountSent} USDC
        </span>
      </div>
      {tx.mintTx && (
        <a href={`${explorer}/tx/${tx.mintTx}`} target="_blank" rel="noreferrer"
          className="text-sky-500 hover:text-sky-400 shrink-0 ml-2">
          {maskTx(tx.mintTx)}
        </a>
      )}
    </div>
  )
}

/* ── Main Component ───────────────────────────────────────────────────── */
export default function BridgePanel() {
  const { address } = useWallet()
  const { state, executeBridge, reset, retryPendingMint, hasPendingMint } = useBridge()

  const [direction, setDirection] = useState<BridgeDirection>('sepolia-to-arc')
  const [amount,    setAmount]    = useState('1')
  const [recipient, setRecipient] = useState('')
  const [balances,  setBalances]  = useState({ sepolia: '—', arc: '—' })
  const [history,   setHistory]   = useState<TxRecord[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [feeInfo,   setFeeInfo]   = useState<CctpFeeInfo | null>(null)
  const [fastAllowance, setFastAllowance] = useState<string | null>(null)
  const [feeLoading, setFeeLoading] = useState(false)

  const isBusy = state.status !== 'idle' && state.status !== 'success' && state.status !== 'error'
  const srcLabel = direction === 'sepolia-to-arc' ? 'Sepolia' : 'Arc Testnet'
  const dstLabel = direction === 'sepolia-to-arc' ? 'Arc Testnet' : 'Sepolia'
  const dstExplorer = direction === 'sepolia-to-arc' ? ARC_EXPLORER : SEPOLIA_EXPLORER

  // Gunakan fee dari Circle API jika tersedia, fallback ke estimasi lokal
  const feeDisplay = feeInfo
    ? { fee: feeInfo.feeUsdc, received: (parseFloat(amount || '0') - parseFloat(feeInfo.feeUsdc)).toFixed(6) }
    : { fee: '0.001000', received: Math.max(0, parseFloat(amount || '0') - 0.001).toFixed(6) }

  /* ── Fetch fee dari Circle API ────────────────────────────────────── */
  useEffect(() => {
    const amt = parseFloat(amount)
    if (!amount || isNaN(amt) || amt <= 0) { setFeeInfo(null); return }

    const src = direction === 'sepolia-to-arc' ? 0 : 26
    const dst = direction === 'sepolia-to-arc' ? 26 : 0

    setFeeLoading(true)
    fetchCctpFee(src, dst, parseUnits(amount, 6))
      .then(f => setFeeInfo(f))
      .catch(() => setFeeInfo(null))
      .finally(() => setFeeLoading(false))
  }, [amount, direction])

  /* ── Fetch fast allowance ─────────────────────────────────────────── */
  useEffect(() => {
    fetchFastAllowance().then(a => setFastAllowance(a)).catch(() => {})
  }, [])

  /* ── Balances ─────────────────────────────────────────────────────── */
  const fetchBalances = useCallback(async () => {
    if (!address) return
    try {
      const [sepBal, arcBal] = await Promise.all([
        makeSepoliaClient().readContract({ address: SEPOLIA_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] }),
        makeArcClient().readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] }),
      ])
      setBalances({
        sepolia: parseFloat(formatUnits(sepBal as bigint, 6)).toFixed(4),
        arc:     parseFloat(formatUnits(arcBal as bigint, 6)).toFixed(4),
      })
    } catch { /* ignore */ }
  }, [address])

  useEffect(() => { fetchBalances() }, [fetchBalances])
  useEffect(() => { const t = setInterval(fetchBalances, 30_000); return () => clearInterval(t) }, [fetchBalances])

  /* ── History ──────────────────────────────────────────────────────── */
  useEffect(() => {
    if (address) setHistory(loadHistory(address).filter(t => t.type === 'bridge').slice(0, 5))
  }, [address, state.status])

  /* ── Step status helper ───────────────────────────────────────────── */
  function stepStatus(targetStep: number): 'idle' | 'active' | 'done' | 'error' {
    if (state.status === 'error') return targetStep <= state.step ? 'error' : 'idle'
    if (state.step > targetStep) return 'done'
    if (state.step === targetStep && state.status !== 'idle') return 'active'
    return 'idle'
  }

  /* ── Bridge handler ───────────────────────────────────────────────── */
  async function handleBridge() {
    const eth = getEvmProvider()
    if (!eth) { alert(NO_WALLET_MSG); return }

    let currentAddress = address
    if (!currentAddress) {
      try {
        const accs: string[] = await eth.request({ method: 'eth_requestAccounts' })
        currentAddress = accs?.[0] ?? null
        if (!currentAddress) return
      } catch { return }
    }

    const amt = parseFloat(amount)
    if (!amount || isNaN(amt) || amt <= 0.001) {
      alert('Jumlah minimum bridge adalah 0.002 USDC (fee 0.001 USDC)')
      return
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient.trim() || currentAddress)) return

    await executeBridge({
      amount,
      direction,
      recipientAddress: recipient.trim() || undefined,
      walletProvider:   eth,
      walletAddress:    currentAddress,
    })

    if (state.status === 'success') fetchBalances()
  }

  /* ── Render ───────────────────────────────────────────────────────── */
  return (
    <div className="space-y-5">

      {/* Direction toggle */}
      <div className="flex items-center gap-2">
        <button type="button"
          onClick={() => { if (!isBusy) { setDirection('sepolia-to-arc'); reset() } }}
          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
            direction === 'sepolia-to-arc'
              ? 'border-emerald-700 bg-emerald-500/10 text-emerald-300'
              : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
          }`}>
          Sepolia → Arc
        </button>
        <button type="button"
          onClick={() => { if (!isBusy) { setDirection('arc-to-sepolia'); reset() } }}
          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
            direction === 'arc-to-sepolia'
              ? 'border-sky-700 bg-sky-500/10 text-sky-300'
              : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
          }`}>
          Arc → Sepolia
        </button>
      </div>

      {/* Balances */}
      {address && (
        <div className="flex items-center justify-between px-1 text-xs text-zinc-600">
          <span>Sepolia USDC: <span className="text-zinc-400">{balances.sepolia}</span></span>
          <span>Arc USDC: <span className="text-zinc-400">{balances.arc}</span></span>
        </div>
      )}

      {/* Amount */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Jumlah USDC ({srcLabel})</label>
        <input
          type="number" min="0.002" step="0.01" value={amount}
          onChange={e => setAmount(e.target.value)}
          disabled={isBusy} placeholder="1"
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600 disabled:opacity-50"
        />
      </div>

      {/* Fee estimate */}
      {parseFloat(amount) > 0 && (
        <div className="px-3 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/20 space-y-1.5 text-xs">
          <div className="flex justify-between text-zinc-500">
            <span>Kamu kirim</span>
            <span className="text-zinc-300 font-medium">{amount} USDC</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>
              CCTP fee {feeInfo?.isFast ? <span className="text-sky-500 ml-1">⚡ Fast</span> : ''}
              {feeLoading && <span className="text-zinc-600 ml-1">…</span>}
            </span>
            <span className="text-red-400">− {feeDisplay.fee} USDC</span>
          </div>
          <div className="border-t border-zinc-800 pt-1.5 flex justify-between">
            <span className="text-zinc-400">Kamu terima (estimasi)</span>
            <span className="text-emerald-400 font-semibold">{feeDisplay.received} USDC</span>
          </div>
          {fastAllowance && (
            <div className="flex justify-between text-zinc-600 pt-0.5 border-t border-zinc-800/50">
              <span>Fast Transfer allowance</span>
              <span>{parseFloat(fastAllowance).toFixed(2)} USDC</span>
            </div>
          )}
        </div>
      )}

      {/* Recipient */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">
          Recipient di {dstLabel} <span className="text-zinc-700">(kosong = wallet kamu)</span>
        </label>
        <input
          type="text" value={recipient}
          onChange={e => setRecipient(e.target.value)}
          disabled={isBusy} placeholder="0x… (opsional)"
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600 disabled:opacity-50"
        />
      </div>

      {/* Bridge button */}
      <button
        type="button" onClick={handleBridge}
        disabled={isBusy || !address}
        className="w-full py-3 rounded-xl border border-emerald-800 bg-emerald-500/10 hover:bg-emerald-500/15 hover:shadow-lg hover:shadow-emerald-500/30 text-sm font-semibold disabled:opacity-50 transition-all"
      >
        {isBusy ? 'Bridging…' : state.status === 'success' ? '✅ Bridge Selesai' : `Bridge ${amount || '?'} USDC →`}
      </button>

      {!address && <p className="text-center text-xs text-zinc-600">Connect wallet untuk bridge</p>}

      {/* Pending mint recovery */}
      {address && hasPendingMint(address) && state.status === 'idle' && (
        <button
          type="button"
          onClick={() => retryPendingMint(address)}
          className="w-full py-2 rounded-lg border border-amber-800 bg-amber-500/10 text-xs font-medium text-amber-300 hover:bg-amber-500/15 transition-colors"
        >
          🔄 Ada mint yang belum selesai — klik untuk retry
        </button>
      )}

      {/* Progress steps */}
      {state.status !== 'idle' && (
        <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30 space-y-0.5">
          <StepRow num={1} label="Approve USDC"              status={stepStatus(1)} />
          <StepRow num={2} label={`Burn di ${srcLabel}`}     status={stepStatus(2)} detail={state.burnTxHash ? maskTx(state.burnTxHash) : undefined} />
          <StepRow num={3} label="Attestation (Circle Iris)" status={stepStatus(3)} />
          <StepRow num={4} label={`Mint di ${dstLabel}`}     status={stepStatus(4)} detail={state.mintTxHash ? maskTx(state.mintTxHash) : undefined} />

          {/* Progress message */}
          {state.progressMsg && state.status !== 'success' && state.status !== 'error' && (
            <p className="text-xs text-amber-400 mt-2">⏳ {state.progressMsg}</p>
          )}

          {/* Elapsed time saat attestation */}
          {state.status === 'awaiting_attestation' && state.elapsedSec > 0 && (
            <p className="text-xs text-zinc-600 mt-1">{Math.floor(state.elapsedSec / 60)}m {state.elapsedSec % 60}s berlalu</p>
          )}

          {/* Success */}
          {state.status === 'success' && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-emerald-400">✅ {state.progressMsg}</p>
              {state.mintTxHash && (
                <a href={`${dstExplorer}/tx/${state.mintTxHash}`} target="_blank" rel="noreferrer"
                  className="block text-xs text-emerald-400 underline hover:text-emerald-300">
                  Lihat di explorer →
                </a>
              )}
              <button type="button" onClick={() => { reset(); fetchBalances() }}
                className="mt-1 text-xs text-zinc-500 hover:text-zinc-400 underline">
                Bridge lagi
              </button>
            </div>
          )}

          {/* Error */}
          {state.status === 'error' && state.error && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-red-400 break-all">❌ {state.error}</p>
              <button type="button" onClick={reset}
                className="text-xs text-zinc-500 hover:text-zinc-400 underline">
                Coba lagi
              </button>
            </div>
          )}
        </div>
      )}

      {/* Transaction history */}
      {history.length > 0 && (
        <div className="border border-zinc-800 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowHistory(v => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs text-zinc-500 hover:text-zinc-400 hover:bg-zinc-900/30 transition-colors"
          >
            <span>Riwayat Bridge ({history.length})</span>
            <span>{showHistory ? '▲' : '▼'}</span>
          </button>
          {showHistory && (
            <div className="px-4 pb-3">
              {history.map(tx => <TxHistoryRow key={tx.id} tx={tx} />)}
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="text-xs text-zinc-700 space-y-0.5 pt-1">
        <p>• Attestation Circle Iris bisa memakan waktu <b className="text-zinc-600">1–20 menit</b> (normal)</p>
        <p>• Arc Testnet otomatis ditambahkan ke wallet jika belum ada</p>
        <p>• CCTP fee: <b className="text-zinc-600">0.001 USDC</b> — minimum bridge 0.002 USDC</p>
        <p>• Butuh USDC Sepolia: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="underline hover:text-zinc-500">faucet.circle.com</a></p>
        <p>• Butuh ETH Sepolia untuk gas approve &amp; burn</p>
      </div>
    </div>
  )
}
