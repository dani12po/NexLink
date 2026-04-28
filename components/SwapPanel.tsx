'use client'
/**
 * components/SwapPanel.tsx
 * Swap USDC ↔ EURC di Arc Testnet via AppKit.swap().
 * Ref: https://docs.arc.network/app-kit/quickstarts/swap-tokens-same-chain
 *
 * Flow: kit.swap({ from: { adapter, chain: "Arc_Testnet" }, tokenIn, tokenOut, amountIn, config: { kitKey } })
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  ARC_CHAIN_ID, ARC_CHAIN_ID_HEX, ARC_EXPLORER, ARC_RPC,
} from '@/lib/arcChain'
import {
  SWAP_TOKENS, fetchLiveRate, calculateQuote,
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

export default function SwapPanel() {
  const { address, chainId } = useWallet()
  const isArc = chainId === ARC_CHAIN_ID
  const { busy, error, txHash, explorerUrl, amountOut, execute, reset } = useSwapExecute()

  const [fromToken,   setFromToken]   = useState<TokenSymbol>('USDC')
  const [toToken,     setToToken]     = useState<TokenSymbol>('EURC')
  const [fromAmount,  setFromAmount]  = useState('')
  const [rate,        setRate]        = useState(0.92)
  const [rateLoading, setRateLoading] = useState(false)
  const [statusMsg,   setStatusMsg]   = useState('')
  const [confirmed,   setConfirmed]   = useState(false)

  const fromInfo = SWAP_TOKENS.find(t => t.symbol === fromToken)!
  const toInfo   = SWAP_TOKENS.find(t => t.symbol === toToken)!

  // Estimasi quote untuk display (rate aktual dari AppKit saat eksekusi)
  const quote = calculateQuote(fromAmount, rate, '0.5')

  // Fetch estimasi rate untuk display
  const loadRate = useCallback(async () => {
    setRateLoading(true)
    const r = await fetchLiveRate(fromToken, toToken)
    setRate(r)
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
        try {
          await eth.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: ARC_CHAIN_ID_HEX }],
          })
        } catch { /* ignore */ }
      }
    }
  }

  function flip() {
    setFromToken(toToken)
    setToToken(fromToken)
    setFromAmount('')
    reset()
    setStatusMsg('')
    setConfirmed(false)
  }

  async function handleSwap() {
    if (!confirmed) { setConfirmed(true); return }
    setConfirmed(false)
    if (!address) return
    if (!isArc) { await switchToArc(); return }

    const ok = await execute(
      {
        fromToken,
        toToken,
        fromAmount,
        slippage:      '0.5',
        rate,
        tokenAddress:  fromInfo.address,
        walletAddress: address,
        isArc,
      },
      setStatusMsg,
    )
    if (ok) setStatusMsg('')
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
            type="number"
            min="0"
            step="0.01"
            value={fromAmount}
            onChange={e => {
              setFromAmount(e.target.value)
              reset()
              setStatusMsg('')
              setConfirmed(false)
            }}
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

      {/* FLIP button + rate display */}
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onClick={flip}
          disabled={busy}
          className="w-9 h-9 rounded-full border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-all hover:rotate-180 duration-300 disabled:opacity-50"
        >
          ⇅
        </button>
        <div className="text-xs text-zinc-600">
          {rateLoading ? (
            <span className="animate-pulse">Fetching rate…</span>
          ) : (
            <span>
              1 {fromToken} ≈ {rate.toFixed(4)} {toToken}
              <span className="text-zinc-700 ml-1">(estimasi)</span>
              <button
                type="button"
                onClick={loadRate}
                className="ml-1 hover:text-zinc-400"
                title="Refresh rate"
              >
                ↻
              </button>
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
            {/* Tampilkan amountOut aktual dari AppKit jika sudah swap, atau estimasi */}
            {amountOut
              ? <span className="text-emerald-400">{amountOut}</span>
              : amt > 0 ? quote.toAmount : '—'
            }
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-sm text-zinc-200">
            <span>{toInfo.emoji}</span>
            <span>{toToken}</span>
          </div>
        </div>
      </div>

      {/* Quote info */}
      {amt > 0 && !txHash && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 px-4 py-3 space-y-1.5 text-xs">
          <div className="flex justify-between text-zinc-500">
            <span>Estimasi diterima</span>
            <span className="text-zinc-300">{quote.toAmount} {toToken}</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Provider fee</span>
            <span className="text-zinc-400">~0.001 USDC</span>
          </div>
          <div className="flex justify-between text-zinc-600 text-xs pt-1 border-t border-zinc-800">
            <span>Powered by Circle AppKit</span>
            <span>Arc Testnet</span>
          </div>
        </div>
      )}

      {/* Konfirmasi modal */}
      {confirmed && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 space-y-3">
          <p className="text-sm font-semibold text-zinc-100">Konfirmasi Swap</p>
          <div className="space-y-1.5 text-xs text-zinc-400">
            <div className="flex justify-between">
              <span>Kirim</span>
              <span className="text-zinc-200 font-medium">{fromAmount} {fromToken}</span>
            </div>
            <div className="flex justify-between">
              <span>Estimasi diterima</span>
              <span className="text-zinc-200 font-medium">{quote.toAmount} {toToken}</span>
            </div>
            <div className="flex justify-between">
              <span>Chain</span>
              <span className="text-zinc-400">Arc Testnet</span>
            </div>
            <div className="flex justify-between">
              <span>Settlement</span>
              <span className="text-zinc-500 font-mono text-[10px]">FxEscrow 0x8676…</span>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setConfirmed(false)}
              className="flex-1 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSwap}
              disabled={busy}
              className="flex-1 py-2 rounded-lg border border-sky-700 bg-sky-500/10 hover:bg-sky-500/15 text-xs font-semibold text-sky-300 disabled:opacity-50 transition-colors"
            >
              {busy ? 'Memproses…' : 'Konfirmasi'}
            </button>
          </div>
        </div>
      )}

      {/* Swap button */}
      {!confirmed && (
        !isArc && address ? (
          <button
            type="button"
            onClick={switchToArc}
            className="w-full py-3 rounded-xl border border-amber-800 bg-amber-500/10 hover:bg-amber-500/15 text-sm font-semibold text-amber-300 transition-all"
          >
            Switch ke Arc Testnet
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSwap}
            disabled={busy || !address || amt <= 0}
            className="w-full py-3 rounded-xl border border-sky-800 bg-sky-500/10 hover:bg-sky-500/15 hover:shadow-lg hover:shadow-sky-500/20 text-sm font-semibold disabled:opacity-50 transition-all"
          >
            {busy
              ? (statusMsg || 'Swapping…')
              : `Swap ${fromAmount || '?'} ${fromToken} → ${toToken}`
            }
          </button>
        )
      )}

      {!address && (
        <p className="text-center text-xs text-zinc-600">Connect wallet untuk swap</p>
      )}

      {statusMsg && !busy && (
        <p className="text-center text-xs text-zinc-400">{statusMsg}</p>
      )}

      {error && (
        <p className="text-xs text-red-400 text-center break-all">{error}</p>
      )}

      {/* Success result */}
      {txHash && (
        <div className="rounded-xl border border-emerald-800/50 bg-emerald-500/5 p-3 space-y-2">
          <p className="text-xs text-emerald-400 font-semibold">✅ Swap berhasil!</p>
          {amountOut && (
            <p className="text-xs text-zinc-300">
              Diterima: <span className="text-emerald-300 font-semibold">{amountOut} {toToken}</span>
            </p>
          )}
          <a
            href={explorerUrl || `${ARC_EXPLORER}/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="block text-xs text-emerald-400 hover:text-emerald-300 underline transition-colors"
          >
            Lihat di ArcScan ↗
          </a>
          <button
            type="button"
            onClick={() => { reset(); setFromAmount(''); setStatusMsg('') }}
            className="text-xs text-zinc-600 hover:text-zinc-400 underline"
          >
            Swap lagi
          </button>
        </div>
      )}

      <div className="text-xs text-zinc-700 space-y-0.5 pt-1 border-t border-zinc-800">
        <p>• Swap USDC ↔ EURC di Arc Testnet via FxEscrow contract</p>
        <p>• FxEscrow: <span className="font-mono">0x8676…9a9f8</span> (Circle StableFX settlement)</p>
        <p>• Butuh USDC: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="underline hover:text-zinc-500">faucet.circle.com</a></p>
      </div>
    </div>
  )
}
