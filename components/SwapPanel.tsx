/**
 * components/SwapPanel.tsx
 * Swap USDC ↔ EURC di Arc Testnet via StableFX FxEscrow.
 * kit.swap() tidak tersedia di testnet — langsung transfer ke FxEscrow.
 */
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  ARC_CHAIN_ID, ARC_CHAIN_ID_HEX, ARC_EXPLORER, ARC_RPC,
} from '@/lib/arcChain'
import {
  SWAP_TOKENS, fetchLiveRate, calculateQuote, getSlippageWarning,
  type TokenSymbol,
} from '@/lib/swapTokens'
import { useSwapExecute } from '@/lib/useSwapExecute'
import { useWallet }      from './WalletButton'
import { getEvmProvider } from '@/lib/evmProvider'

const ARC_CHAIN_PARAMS = {
  chainId:           ARC_CHAIN_ID_HEX,
  chainName:         'Arc Testnet',
  nativeCurrency:    { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls:           [ARC_RPC],
  blockExplorerUrls: [ARC_EXPLORER],
}

const SLIPPAGE_PRESETS = ['0.5', '1.0', '2.0']

export default function SwapPanel() {
  const { address, chainId } = useWallet()
  const isArc = chainId === ARC_CHAIN_ID
  const { busy, error, txHash, execute, reset } = useSwapExecute()

  const [fromToken,  setFromToken]  = useState<TokenSymbol>('USDC')
  const [toToken,    setToToken]    = useState<TokenSymbol>('EURC')
  const [fromAmount, setFromAmount] = useState('')
  const [slippage,   setSlippage]   = useState('0.5')
  const [customSlip, setCustomSlip] = useState('')
  const [rate,       setRate]       = useState(0.92)
  const [isLive,     setIsLive]     = useState(false)
  const [rateLoading, setRateLoading] = useState(false)
  const [statusMsg,  setStatusMsg]  = useState('')
  const [confirmed,  setConfirmed]  = useState(false)

  const fromInfo = SWAP_TOKENS.find(t => t.symbol === fromToken)!
  const toInfo   = SWAP_TOKENS.find(t => t.symbol === toToken)!
  const quote    = calculateQuote(fromAmount, rate, slippage)
  const slipWarn = getSlippageWarning(parseFloat(slippage))

  // Fetch live rate
  const loadRate = useCallback(async () => {
    setRateLoading(true)
    const r = await fetchLiveRate(fromToken, toToken)
    setRate(r)
    setIsLive(true)
    setRateLoading(false)
  }, [fromToken, toToken])

  useEffect(() => { loadRate() }, [loadRate])

  async function switchToArc() {
    const eth = getEvmProvider()
    if (!eth) return
    try {
      await eth.request({ method: 'wallet_addEthereumChain', params: [ARC_CHAIN_PARAMS] })
    } catch (e: any) {
      if (e?.code !== 4001) {
        try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] }) }
        catch { /* ignore */ }
      }
    }
  }

  function flip() {
    setFromToken(toToken); setToToken(fromToken)
    setFromAmount(''); reset(); setStatusMsg(''); setConfirmed(false)
  }

  async function handleSwap() {
    if (!confirmed) { setConfirmed(true); return }
    setConfirmed(false)
    if (!address) return
    if (!isArc) { await switchToArc(); return }

    const tokenAddress = fromInfo.address
    const ok = await execute(
      { fromToken, toToken, fromAmount, slippage, rate, tokenAddress, walletAddress: address, isArc },
      setStatusMsg,
    )
    if (ok) setStatusMsg('Swap berhasil!')
  }

  const amt = parseFloat(fromAmount) || 0

  return (
    <div className="space-y-4">
      {/* FROM */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-500">From</span>
          <span className="text-xs text-zinc-600">{fromToken}</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number" min="0" step="0.01" value={fromAmount}
            onChange={e => { setFromAmount(e.target.value); reset(); setStatusMsg(''); setConfirmed(false) }}
            disabled={busy}
            className="flex-1 bg-transparent text-xl font-semibold outline-none text-zinc-100 disabled:opacity-50"
            placeholder="0.00"
          />
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-sm text-zinc-200">
            <span>{fromInfo.emoji}</span>
            <span>{fromToken}</span>
          </div>
        </div>
      </div>

      {/* FLIP */}
      <div className="flex items-center justify-between px-1">
        <button type="button" onClick={flip} disabled={busy}
          className="w-9 h-9 rounded-full border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-all hover:rotate-180 duration-300 disabled:opacity-50">
          ⇅
        </button>
        <div className="text-xs text-zinc-600">
          {rateLoading ? (
            <span className="animate-pulse">Fetching rate…</span>
          ) : (
            <span>
              1 {fromToken} ≈ {rate.toFixed(4)} {toToken}
              {isLive && <span className="text-emerald-500 ml-1">● live</span>}
              <button type="button" onClick={loadRate} className="ml-1 hover:text-zinc-400">↻</button>
            </span>
          )}
        </div>
      </div>

      {/* TO */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-500">To (estimasi)</span>
          <span className="text-xs text-zinc-600">{toToken}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 text-xl font-semibold text-zinc-300">
            {amt > 0 ? quote.toAmount : '—'}
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-sm text-zinc-200">
            <span>{toInfo.emoji}</span>
            <span>{toToken}</span>
          </div>
        </div>
      </div>

      {/* Slippage */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">Slippage tolerance</span>
          {slipWarn && <span className="text-xs text-amber-400">⚠ Slippage tinggi</span>}
        </div>
        <div className="flex gap-1.5">
          {SLIPPAGE_PRESETS.map(p => (
            <button key={p} type="button"
              onClick={() => { setSlippage(p); setCustomSlip('') }}
              className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
                slippage === p && !customSlip
                  ? 'border-sky-700 bg-sky-500/10 text-sky-300'
                  : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
              }`}>
              {p}%
            </button>
          ))}
          <input
            type="number" min="0.1" max="50" step="0.1"
            value={customSlip}
            onChange={e => { setCustomSlip(e.target.value); setSlippage(e.target.value || '0.5') }}
            placeholder="Custom"
            className="flex-1 px-2 py-1 rounded-lg border border-zinc-800 bg-transparent text-xs text-zinc-300 outline-none focus:border-zinc-600"
          />
        </div>
      </div>

      {/* Quote info */}
      {amt > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 px-4 py-3 space-y-1.5 text-xs">
          <div className="flex justify-between text-zinc-500">
            <span>Min. diterima</span>
            <span className="text-zinc-300">{quote.minReceived} {toToken}</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Gas fee</span>
            <span className="text-zinc-400">~0.001 USDC</span>
          </div>
          <div className="flex justify-between text-zinc-600 text-xs pt-1 border-t border-zinc-800">
            <span>Powered by StableFX</span>
            <span>FxEscrow settlement</span>
          </div>
        </div>
      )}

      {/* Konfirmasi modal */}
      {confirmed && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 space-y-3">
          <p className="text-sm font-semibold text-zinc-100">Konfirmasi Swap</p>
          <div className="space-y-1.5 text-xs text-zinc-400">
            <div className="flex justify-between"><span>Kirim</span><span className="text-zinc-200 font-medium">{fromAmount} {fromToken}</span></div>
            <div className="flex justify-between"><span>Terima (estimasi)</span><span className="text-zinc-200 font-medium">{quote.toAmount} {toToken}</span></div>
            <div className="flex justify-between"><span>Min. diterima</span><span>{quote.minReceived} {toToken}</span></div>
            <div className="flex justify-between"><span>Slippage</span><span>{slippage}%</span></div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setConfirmed(false)}
              className="flex-1 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-400 hover:bg-zinc-800 transition-colors">
              Batal
            </button>
            <button type="button" onClick={handleSwap} disabled={busy}
              className="flex-1 py-2 rounded-lg border border-sky-700 bg-sky-500/10 hover:bg-sky-500/15 text-xs font-semibold text-sky-300 disabled:opacity-50 transition-colors">
              {busy ? 'Memproses…' : 'Konfirmasi'}
            </button>
          </div>
        </div>
      )}

      {/* Swap button */}
      {!confirmed && (
        !isArc && address ? (
          <button type="button" onClick={switchToArc}
            className="w-full py-3 rounded-xl border border-amber-800 bg-amber-500/10 hover:bg-amber-500/15 text-sm font-semibold text-amber-300 transition-all">
            Switch ke Arc Testnet
          </button>
        ) : (
          <button type="button" onClick={handleSwap}
            disabled={busy || !address || amt <= 0}
            className="w-full py-3 rounded-xl border border-sky-800 bg-sky-500/10 hover:bg-sky-500/15 hover:shadow-lg hover:shadow-sky-500/20 text-sm font-semibold disabled:opacity-50 transition-all">
            {busy ? (statusMsg || 'Swapping…') : `Swap ${fromAmount || '?'} ${fromToken} → ${toToken}`}
          </button>
        )
      )}

      {!address && <p className="text-center text-xs text-zinc-600">Connect wallet untuk swap</p>}
      {statusMsg && !busy && <p className="text-center text-xs text-zinc-400">{statusMsg}</p>}
      {error && <p className="text-xs text-red-400 text-center break-all">{error}</p>}

      {txHash && (
        <a href={`${ARC_EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer"
          className="block text-center text-xs text-emerald-400 hover:text-emerald-300 underline transition-colors">
          ✅ Swap berhasil — lihat di ArcScan ↗
        </a>
      )}

      <div className="text-xs text-zinc-700 space-y-0.5 pt-1 border-t border-zinc-800">
        <p>• Hanya USDC↔EURC yang didukung di Arc Testnet</p>
        <p>• Swap via StableFX FxEscrow — kit.swap() tidak tersedia di testnet</p>
      </div>
    </div>
  )
}
