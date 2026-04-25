/**
 * components/BridgePanel.tsx
 * Bridge USDC Sepolia ↔ Arc Testnet via @circle-fin/bridge-kit (CCTP V2).
 */
'use client'

import React, { useState } from 'react'
import {
  CHAIN_ARC, CHAIN_SEPOLIA, CCTP_MIN_BRIDGE,
  ARC_EXPLORER, SEPOLIA_EXPLORER, ARC_CHAIN_ID, SEPOLIA_CHAIN_ID,
  ARC_CHAIN_ID_HEX, ARC_RPC,
} from '@/lib/arcChain'
import { useEvmAdapter }  from '@/hooks/useEvmAdapter'
import { useBridge, type BridgeStepEvent } from '@/hooks/useBridge'
import { useProgress, type ProgressStep } from '@/hooks/useProgress'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import { useWallet }      from './WalletButton'
import { addTx, updateTx } from '@/lib/txHistory'
import { getEvmProvider } from '@/lib/evmProvider'

const CHAINS = [
  { id: CHAIN_SEPOLIA, name: 'Ethereum Sepolia', chainId: SEPOLIA_CHAIN_ID },
  { id: CHAIN_ARC,     name: 'Arc Testnet',      chainId: ARC_CHAIN_ID     },
]

const STEP_ORDER: ProgressStep[] = ['approving', 'burning', 'attesting', 'minting', 'done']
const STEP_LABELS_SHORT = ['Approve', 'Burn', 'Attestation', 'Mint']

function StepIndicator({ step }: { step: ProgressStep }) {
  const curIdx = STEP_ORDER.indexOf(step)
  return (
    <div className="flex items-center gap-1">
      {STEP_LABELS_SHORT.map((label, i) => {
        const stepKey = STEP_ORDER[i]
        const done    = curIdx > i || step === 'done'
        const active  = curIdx === i && step !== 'done' && step !== 'error'
        const err     = step === 'error' && curIdx === i
        return (
          <React.Fragment key={stepKey}>
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
                {label}
              </span>
            </div>
            {i < STEP_LABELS_SHORT.length - 1 && (
              <div className={`flex-1 h-px mb-5 transition-colors ${done ? 'bg-emerald-500/40' : 'bg-zinc-800'}`} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

function maskTx(h: string) { return h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '' }

export default function BridgePanel() {
  const { address } = useWallet()
  const { evmAdapter } = useEvmAdapter()
  const { bridge, retry, isLoading, error, result, reset: resetBridge } = useBridge()
  const { step, stepLabel, logs, errMsg, handleStepEvent, reset: resetProgress } = useProgress()
  const { arc: arcBal, sepolia: sepoliaBal, refresh: refreshBal } = useUsdcBalance(null, address)

  const [fromChain, setFromChain] = useState<string>(CHAIN_SEPOLIA)
  const [toChain,   setToChain]   = useState<string>(CHAIN_ARC)
  const [amount,    setAmount]    = useState('')

  const isBusy  = isLoading
  const isDone  = step === 'done'
  const isError = step === 'error' || !!error

  const amtNum     = parseFloat(amount) || 0
  const tooSmall   = amtNum > 0 && amtNum < CCTP_MIN_BRIDGE
  const srcBalance = fromChain === CHAIN_ARC ? arcBal : sepoliaBal
  const srcBalNum  = parseFloat(srcBalance.replace(/,/g, '')) || 0
  const hasBalance = amtNum <= 0 || srcBalNum >= amtNum

  function flip() {
    if (isBusy) return
    setFromChain(toChain); setToChain(fromChain)
    setAmount(''); resetBridge(); resetProgress()
  }

  function chainLabel(id: string) {
    return CHAINS.find(c => c.id === id)?.name ?? id
  }

  // Explorer URL bergantung pada step: burn = fromChain, mint = toChain
  function explorerUrl(stepName: string, hash: string) {
    const chain = stepName === 'mint' ? toChain : fromChain
    return chain === CHAIN_ARC ? `${ARC_EXPLORER}/tx/${hash}` : `${SEPOLIA_EXPLORER}/tx/${hash}`
  }

  async function handleBridge() {
    if (!address || !evmAdapter) return

    // Switch ke source chain via window.ethereum langsung (tidak butuh wagmi connector)
    const srcChain = CHAINS.find(c => c.id === fromChain)
    if (srcChain?.chainId) {
      const eth = getEvmProvider()
      if (eth) {
        const chainHex = `0x${srcChain.chainId.toString(16)}`
        try {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] })
        } catch (e: any) {
          if (e?.code === 4902) {
            // Chain belum ada di wallet — tambahkan Arc Testnet
            if (srcChain.id === CHAIN_ARC) {
              try {
                await eth.request({ method: 'wallet_addEthereumChain', params: [{
                  chainId: ARC_CHAIN_ID_HEX, chainName: 'Arc Testnet',
                  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
                  rpcUrls: [ARC_RPC], blockExplorerUrls: [ARC_EXPLORER],
                }]})
              } catch { /* ignore */ }
            }
          }
          // Jika user reject atau error lain — lanjut saja, bridge akan gagal sendiri
        }
      }
    }

    const txRecord = addTx({
      type: 'bridge', status: 'pending',
      direction: fromChain === CHAIN_ARC ? 'arc-to-sepolia' : 'sepolia-to-arc',
      fromChain: chainLabel(fromChain), toChain: chainLabel(toChain),
      amountSent: amount, wallet: address,
    })

    resetProgress()
    resetBridge()

    try {
      const res = await bridge({
        fromChain, toChain, amount, adapter: evmAdapter,
        onStep: (evt: BridgeStepEvent) => {
          handleStepEvent(evt)
        },
      })
      updateTx(txRecord.id, { status: 'success', mintTx: res.mintTxHash }, address)
      refreshBal()
    } catch (e: any) {
      updateTx(txRecord.id, { status: 'failed', errorMsg: e?.message }, address)
    }
  }

  async function handleRetry() {
    if (!address || !evmAdapter) return
    resetProgress()
    try {
      await retry(evmAdapter, toChain, handleStepEvent)
      refreshBal()
    } catch { /* error sudah di-handle */ }
  }

  return (
    <div className="space-y-5">
      {/* Direction selector */}
      <div className="flex items-center gap-2">
        <select
          value={fromChain}
          onChange={e => { if (!isBusy) { setFromChain(e.target.value); resetBridge(); resetProgress() } }}
          disabled={isBusy}
          className="flex-1 px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900/60 text-sm text-zinc-200 outline-none focus:border-zinc-600 disabled:opacity-50"
        >
          {CHAINS.filter(c => c.id !== toChain).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <button type="button" onClick={flip} disabled={isBusy}
          className="w-9 h-9 rounded-full border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-all hover:rotate-180 duration-300 disabled:opacity-50">
          ↔
        </button>

        <select
          value={toChain}
          onChange={e => { if (!isBusy) { setToChain(e.target.value); resetBridge(); resetProgress() } }}
          disabled={isBusy}
          className="flex-1 px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900/60 text-sm text-zinc-200 outline-none focus:border-zinc-600 disabled:opacity-50"
        >
          {CHAINS.filter(c => c.id !== fromChain).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Balances */}
      {address && (
        <div className="flex justify-between px-1 text-xs text-zinc-600">
          <span>{chainLabel(fromChain)}: <span className="text-zinc-400">{srcBalance} USDC</span></span>
          <span>{chainLabel(toChain)}: <span className="text-zinc-400">{fromChain === CHAIN_ARC ? sepoliaBal : arcBal} USDC</span></span>
        </div>
      )}

      {/* Amount */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Jumlah USDC</label>
        <input
          type="number" min={CCTP_MIN_BRIDGE} step="0.01" value={amount}
          onChange={e => setAmount(e.target.value)}
          disabled={isBusy} placeholder="1.00"
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600 disabled:opacity-50"
        />
        {tooSmall && (
          <p className="text-xs text-amber-400 mt-1">⚠ Minimum bridge {CCTP_MIN_BRIDGE} USDC</p>
        )}
        {!hasBalance && amtNum > 0 && (
          <p className="text-xs text-red-400 mt-1">⚠ Saldo tidak cukup ({srcBalance} USDC)</p>
        )}
      </div>

      {/* Fee info */}
      {amtNum >= CCTP_MIN_BRIDGE && (
        <div className="px-3 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/20 space-y-1 text-xs">
          <div className="flex justify-between text-zinc-500">
            <span>Kamu kirim</span>
            <span className="text-zinc-300">{amount} USDC</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>CCTP fee (estimasi)</span>
            <span className="text-red-400">− 0.002 USDC</span>
          </div>
          <div className="border-t border-zinc-800 pt-1 flex justify-between">
            <span className="text-zinc-400">Estimasi diterima</span>
            <span className="text-emerald-400 font-semibold">{Math.max(0, amtNum - 0.002).toFixed(6)} USDC</span>
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={handleBridge}
        disabled={isBusy || !address || !evmAdapter || !amount || tooSmall || !hasBalance}
        className="w-full py-3 rounded-xl border border-emerald-800 bg-emerald-500/10 hover:bg-emerald-500/15 hover:shadow-lg hover:shadow-emerald-500/20 text-sm font-semibold disabled:opacity-50 transition-all"
      >
        {isBusy ? stepLabel : isDone ? '✅ Bridge Selesai' : `Bridge ${amount || '?'} USDC →`}
      </button>

      {!address && <p className="text-center text-xs text-zinc-600">Connect wallet untuk bridge</p>}
      {address && !evmAdapter && <p className="text-center text-xs text-zinc-600">Memuat adapter wallet…</p>}

      {/* Progress */}
      {step !== 'idle' && (
        <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30 space-y-4">
          <StepIndicator step={step} />

          {logs.length > 0 && (
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {logs.map((log, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-zinc-600 shrink-0 font-mono">
                    {new Date(log.time).toLocaleTimeString()}
                  </span>
                  <span className={log.state === 'error' ? 'text-red-400' : log.state === 'success' ? 'text-emerald-400' : 'text-zinc-400'}>
                    {log.step} — {log.state}
                  </span>
                  {log.txHash && (
                    <a href={explorerUrl(log.step, log.txHash)} target="_blank" rel="noreferrer"
                      className="text-sky-500 hover:text-sky-400 shrink-0 font-mono">
                      {maskTx(log.txHash)}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {isDone && result && (
            <div className="space-y-2">
              <p className="text-xs text-emerald-400 font-medium">✅ Bridge berhasil!</p>
              {result.mintTxHash && (
                <a href={explorerUrl('mint', result.mintTxHash)} target="_blank" rel="noreferrer"
                  className="block text-xs text-emerald-400 underline hover:text-emerald-300">
                  Lihat mint tx di explorer →
                </a>
              )}
              <button type="button"
                onClick={() => { resetBridge(); resetProgress(); setAmount('') }}
                className="text-xs text-zinc-500 hover:text-zinc-400 underline">
                Bridge lagi
              </button>
            </div>
          )}

          {isError && (
            <div className="space-y-2">
              <p className="text-xs text-red-400 break-all">❌ {errMsg || error || 'Bridge gagal'}</p>
              <button type="button" onClick={handleRetry} disabled={isBusy}
                className="w-full py-2 rounded-lg border border-amber-800 bg-amber-500/10 hover:bg-amber-500/15 text-xs font-medium text-amber-300 disabled:opacity-50 transition-colors">
                {isBusy ? '⏳ Mencoba ulang…' : '🔄 Coba Lagi'}
              </button>
              <button type="button"
                onClick={() => { resetBridge(); resetProgress() }}
                className="text-xs text-zinc-500 hover:text-zinc-400 underline">
                Mulai ulang
              </button>
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-zinc-700 space-y-0.5 pt-1">
        <p>• Bridge via Circle CCTP V2 — Approve → Burn → Attestation → Mint</p>
        <p>• Attestation bisa memakan waktu <b className="text-zinc-600">1–20 menit</b> di testnet</p>
        <p>• Butuh USDC: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="underline hover:text-zinc-500">faucet.circle.com</a></p>
      </div>
    </div>
  )
}
