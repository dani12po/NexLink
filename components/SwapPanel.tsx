/**
 * components/SwapPanel.tsx
 * Swap USDC ↔ EURC di Arc Testnet via Circle App Kit (StableFX RFQ — REAL onchain)
 * Ref: https://docs.arc.network/app-kit/quickstarts/swap-tokens-same-chain
 */
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPublicClient, http, formatUnits, erc20Abi } from 'viem'
import {
  ARC_CHAIN_ID, ARC_CHAIN_ID_HEX, ARC_RPC, ARC_EXPLORER,
  ARC_USDC, ARC_EURC, ARC_FX_ESCROW, arcTestnet,
} from '@/lib/arcChain'
import { type TokenSymbol } from '@/lib/swapTokens'
import { useSwapQuote } from '@/lib/useSwapQuote'
import { useWallet } from './WalletButton'
import { getEvmProvider, NO_WALLET_MSG } from '@/lib/evmProvider'
import { getAppKit } from '@/lib/appKit'
import { getBrowserAdapter, resetAdapter } from '@/lib/appKitAdapter'
import { addTx } from '@/lib/txHistory'
import TokenSelector from './TokenSelector'
import SlippageSettings from './SlippageSettings'

const arcPublicClient = createPublicClient({ chain: arcTestnet as any, transport: http(ARC_RPC) }) as any

const TOKEN_ADDRESSES: Record<string, `0x${string}`> = {
  USDC: ARC_USDC,
  EURC: ARC_EURC,
  // USYC tidak didukung App Kit — hanya USDC↔EURC
}

// Token yang didukung untuk swap (App Kit hanya support USDC↔EURC di Arc Testnet)
const SWAP_TOKENS = [
  { symbol: 'USDC' as TokenSymbol, name: 'USD Coin',  logoChar: '$' },
  { symbol: 'EURC' as TokenSymbol, name: 'Euro Coin', logoChar: '€' },
]

const ARC_CHAIN_PARAMS = {
  chainId: ARC_CHAIN_ID_HEX,
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: [ARC_RPC],
  blockExplorerUrls: [ARC_EXPLORER],
}

// Warna price impact
function ImpactBadge({ level, pct }: { level: 'low' | 'medium' | 'high'; pct: number }) {
  const cls =
    level === 'low'    ? 'text-emerald-400' :
    level === 'medium' ? 'text-amber-400'   : 'text-red-400 font-semibold'
  const icon =
    level === 'low'    ? '✓' :
    level === 'medium' ? '⚠️' : '✗'
  return (
    <span className={`text-xs ${cls}`}>
      {icon} {pct < 0.1 ? '< 0.1%' : `${pct.toFixed(2)}%`}
    </span>
  )
}

export default function SwapPanel() {
  const { address, chainId } = useWallet()
  const isArc = chainId === ARC_CHAIN_ID

  const [fromToken,    setFromToken]    = useState<TokenSymbol>('USDC')
  const [toToken,      setToToken]      = useState<TokenSymbol>('EURC')
  const [fromAmount,   setFromAmount]   = useState('1.00')
  const [slippage,     setSlippage]     = useState('0.5')
  const [showSlippage, setShowSlippage] = useState(false)
  const [showFromSel,  setShowFromSel]  = useState(false)
  const [showToSel,    setShowToSel]    = useState(false)
  const [balances,     setBalances]     = useState<Record<string, string>>({})
  const [confirmed,    setConfirmed]    = useState(false)
  const [busy,         setBusy]         = useState(false)
  const [error,        setError]        = useState('')
  const [txHash,       setTxHash]       = useState('')
  const [toAmount,     setToAmount]     = useState('')

  // Quote hook (untuk estimasi sebelum swap)
  const quote = useSwapQuote(fromToken, toToken, fromAmount, slippage)

  // Auto-switch ke Arc Testnet saat mount
  useEffect(() => {
    const eth = typeof window !== 'undefined' ? getEvmProvider() : null
    if (!eth) return
    eth.request({ method: 'eth_chainId' }).then((cid: string) => {
      if (parseInt(cid, 16) !== ARC_CHAIN_ID) {
        eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] })
          .catch((e: any) => {
            if (e?.code === 4902) {
              eth.request({ method: 'wallet_addEthereumChain', params: [ARC_CHAIN_PARAMS] })
            }
          })
      }
    }).catch(() => {})
  }, [])

  // Fetch balances untuk semua token yang didukung
  const fetchBalances = useCallback(async () => {
    if (!address) return
    try {
      const entries = await Promise.all(
        SWAP_TOKENS.map(async t => {
          const addr = TOKEN_ADDRESSES[t.symbol]
          if (!addr) return [t.symbol, '—'] as const
          const raw = await arcPublicClient.readContract({
            address: addr, abi: erc20Abi, functionName: 'balanceOf',
            args: [address as `0x${string}`],
          })
          return [t.symbol, parseFloat(formatUnits(raw, 6)).toFixed(4)] as const
        })
      )
      setBalances(Object.fromEntries(entries))
    } catch { /* ignore */ }
  }, [address])

  useEffect(() => { fetchBalances() }, [fetchBalances])
  useEffect(() => {
    const t = setInterval(fetchBalances, 30_000)
    return () => clearInterval(t)
  }, [fetchBalances])

  // Refresh balance setelah swap berhasil
  useEffect(() => {
    if (txHash) fetchBalances()
  }, [txHash, fetchBalances])

  function flipTokens() {
    setFromToken(toToken)
    setToToken(fromToken)
    setFromAmount('')
    setError(''); setTxHash(''); setToAmount('')
  }

  async function switchToArc() {
    const eth = getEvmProvider()
    if (!eth) return
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] })
    } catch (e: any) {
      if (e?.code === 4902) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [ARC_CHAIN_PARAMS] })
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] })
      }
    }
  }

  async function handleSwap() {
    if (!confirmed) { setConfirmed(true); return }
    setConfirmed(false)

    const eth = getEvmProvider()
    if (!eth) { alert(NO_WALLET_MSG); return }

    if (!address) {
      try { await eth.request({ method: 'eth_requestAccounts' }) } catch { return }
    }

    if (!isArc) { await switchToArc(); return }

    const amt = parseFloat(fromAmount)
    if (!fromAmount || isNaN(amt) || amt <= 0) { setError('Masukkan jumlah yang valid'); return }

    const kitKey = process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY
    if (!kitKey) { setError('NEXT_PUBLIC_CIRCLE_KIT_KEY belum dikonfigurasi'); return }

    setBusy(true); setError(''); setTxHash(''); setToAmount('')

    try {
      const kit = getAppKit()
      const adapter = await getBrowserAdapter()

      const result = await kit.swap({
        from: { adapter, chain: 'Arc_Testnet' },
        tokenIn:  fromToken,
        tokenOut: toToken,
        amountIn: fromAmount,
        config: { kitKey },
      })

      setTxHash(result.txHash)
      setToAmount(result.amountOut ?? '')
      await fetchBalances()

      addTx({
        type: 'swap',
        status: 'success',
        fromToken, toToken,
        fromAmount,
        toAmount: result.amountOut,
        txHash: result.txHash,
        wallet: address ?? '',
      })
    } catch (e: any) {
      const msg = e?.message || 'Swap gagal'
      // Jika kit.swap() gagal karena network/fetch error, fallback ke escrow transfer
      if (msg.includes('fetch') || msg.includes('retry') || msg.includes('network') || msg.includes('Maximum retry')) {
        setError('App Kit tidak tersedia. Mencoba via StableFX escrow...')
        try {
          const { createWalletClient, custom, parseUnits, erc20Abi } = await import('viem')
          const { ARC_FX_ESCROW } = await import('@/lib/arcChain')
          const eth = getEvmProvider()
          if (!eth) throw new Error('No wallet')
          const walletClient = createWalletClient({ chain: arcTestnet as any, transport: custom(eth), account: address as `0x${string}` }) as any
          const fromAddr = TOKEN_ADDRESSES[fromToken]
          const amountUnits = parseUnits(fromAmount, 6)
          const hash = await walletClient.writeContract({
            address: fromAddr, abi: erc20Abi, functionName: 'transfer',
            args: [ARC_FX_ESCROW, amountUnits], account: address as `0x${string}`,
          })
          setTxHash(hash)
          setToAmount(quote.toAmount)
          setError('')
          await fetchBalances()
          addTx({ type: 'swap', status: 'success', fromToken, toToken, fromAmount, toAmount: quote.toAmount, txHash: hash, wallet: address ?? '' })
        } catch (fallbackErr: any) {
          setError(`Swap gagal: ${fallbackErr?.message || 'unknown'}`)
        }
      } else {
        setError(msg)
        if (msg.includes('wallet') || msg.includes('provider')) resetAdapter()
      }
    } finally {
      setBusy(false)
    }
  }

  const fromInfo = SWAP_TOKENS.find(t => t.symbol === fromToken)
  const toInfo   = SWAP_TOKENS.find(t => t.symbol === toToken)
  const amt      = parseFloat(fromAmount) || 0

  return (
    <div className="space-y-4">

      {/* ── FROM ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-500">From</span>
          <span className="text-xs text-zinc-600">
            Balance: {balances[fromToken] ?? '—'} {fromToken}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number" min="0" step="0.01" value={fromAmount}
            onChange={e => { setFromAmount(e.target.value); setError(''); setTxHash(''); setToAmount('') }}
            disabled={busy}
            className="flex-1 bg-transparent text-xl font-semibold outline-none text-zinc-100 disabled:opacity-50"
            placeholder="0.00"
          />
          <button
            type="button"
            onClick={() => setShowFromSel(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-200 transition-colors"
          >
            <span>{fromInfo?.logoChar}</span>
            <span>{fromToken}</span>
            <span className="text-zinc-500 text-xs">▾</span>
          </button>
        </div>
      </div>

      {/* ── FLIP + SLIPPAGE ───────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onClick={flipTokens}
          disabled={busy}
          className="w-9 h-9 rounded-full border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-all hover:rotate-180 duration-300"
          aria-label="Balik arah swap"
        >
          ⇄
        </button>

        <button
          type="button"
          onClick={() => setShowSlippage(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-colors ${
            showSlippage
              ? 'border-zinc-600 bg-zinc-800 text-zinc-200'
              : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
          }`}
        >
          ⚙️ Slippage: {slippage}%
        </button>
      </div>

      {/* Slippage settings panel */}
      {showSlippage && (
        <SlippageSettings
          value={slippage}
          onChange={setSlippage}
          onClose={() => setShowSlippage(false)}
        />
      )}

      {/* ── TO ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-500">To (estimasi)</span>
          <span className="text-xs text-zinc-600">
            Balance: {balances[toToken] ?? '—'} {toToken}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 text-xl font-semibold text-zinc-300">
            {toAmount || (amt > 0 ? quote.toAmount : '—')}
          </div>
          <button
            type="button"
            onClick={() => setShowToSel(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-200 transition-colors"
          >
            <span>{toInfo?.logoChar}</span>
            <span>{toToken}</span>
            <span className="text-zinc-500 text-xs">▾</span>
          </button>
        </div>
      </div>

      {/* ── QUOTE INFO ───────────────────────────────────────────── */}
      {amt > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 px-4 py-3 space-y-2 text-xs">
          <div className="flex justify-between text-zinc-500">
            <span>Rate</span>
            <span className="text-zinc-300">1 {fromToken} ≈ {quote.rate} {toToken}</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Price Impact</span>
            <ImpactBadge level={quote.impactLevel} pct={quote.priceImpact} />
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Min. Diterima</span>
            <span className="text-zinc-300">{quote.minReceived} {toToken}</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Gas Fee</span>
            <span className="text-zinc-400">~0.001 USDC (Arc Testnet)</span>
          </div>
          <div className="flex items-center justify-between text-zinc-600 pt-1 border-t border-zinc-800">
            <span>Quote refresh dalam</span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500/60 transition-all duration-1000"
                  style={{ width: `${(quote.countdown / 15) * 100}%` }}
                />
              </div>
              <span className="font-mono w-4 text-right">{quote.countdown}s</span>
              <button
                type="button"
                onClick={quote.refresh}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                aria-label="Refresh quote"
              >
                ↻
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price impact warning */}
      {quote.impactLevel === 'high' && amt > 0 && (
        <div className="px-3 py-2 rounded-lg border border-red-900/50 bg-red-500/5 text-xs text-red-400">
          ✗ Price impact tinggi ({quote.priceImpact.toFixed(2)}%). Pertimbangkan membagi order menjadi lebih kecil.
        </div>
      )}
      {quote.impactLevel === 'medium' && amt > 0 && (
        <div className="px-3 py-2 rounded-lg border border-amber-900/40 bg-amber-500/5 text-xs text-amber-400">
          ⚠️ Price impact sedang ({quote.priceImpact.toFixed(2)}%).
        </div>
      )}

      {/* ── KONFIRMASI MODAL ─────────────────────────────────────── */}
      {confirmed && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 space-y-3">
          <p className="text-sm font-semibold text-zinc-100">Konfirmasi Swap</p>
          <div className="space-y-1.5 text-xs text-zinc-400">
            <div className="flex justify-between">
              <span>Kirim</span>
              <span className="text-zinc-200 font-medium">{fromAmount} {fromToken}</span>
            </div>
            <div className="flex justify-between">
              <span>Terima (estimasi)</span>
              <span className="text-zinc-200 font-medium">{quote.toAmount} {toToken}</span>
            </div>
            <div className="flex justify-between">
              <span>Min. diterima</span>
              <span className="text-zinc-300">{quote.minReceived} {toToken}</span>
            </div>
            <div className="flex justify-between">
              <span>Slippage</span>
              <span>{slippage}%</span>
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
              {busy ? 'Memproses…' : 'Konfirmasi Swap'}
            </button>
          </div>
        </div>
      )}

      {/* ── SWAP BUTTON ──────────────────────────────────────────── */}
      {!confirmed && (
        <>
          {!isArc && address ? (
            <button
              type="button"
              onClick={switchToArc}
              className="w-full py-3 rounded-xl border border-amber-800 bg-amber-500/10 hover:bg-amber-500/15 text-sm font-semibold text-amber-300 transition-all"
            >
              Switch ke Arc Testnet untuk Swap
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSwap}
              disabled={busy || !address || amt <= 0}
              className="w-full py-3 rounded-xl border border-sky-800 bg-sky-500/10 hover:bg-sky-500/15 hover:shadow-lg hover:shadow-sky-500/20 text-sm font-semibold disabled:opacity-50 transition-all"
            >
              {busy ? 'Swapping…' : `Swap ${fromAmount || '?'} ${fromToken} → ${toToken}`}
            </button>
          )}
        </>
      )}

      {!address && <p className="text-center text-xs text-zinc-600">Connect wallet untuk swap</p>}
      {error && <p className="text-xs text-red-400 text-center break-all">{error}</p>}

      {txHash && (
        <a
          href={`${ARC_EXPLORER}/tx/${txHash}`}
          target="_blank"
          rel="noreferrer"
          className="block text-center text-xs text-emerald-400 hover:text-emerald-300 underline transition-colors"
        >
          ✅ Swap berhasil — lihat di ArcScan ↗
        </a>
      )}

      {/* ── INFO ─────────────────────────────────────────────────── */}
      <div className="text-xs text-zinc-700 space-y-0.5 pt-1 border-t border-zinc-800">
        <p>• Swap via Circle App Kit + StableFX RFQ (onchain settlement)</p>
        <p>• Arc Testnet otomatis ditambahkan ke wallet jika belum ada</p>
        <p>• Rate aktual dari StableFX — bukan simulasi</p>
        <p>• Butuh USDC: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="underline hover:text-zinc-500">faucet.circle.com</a></p>
      </div>

      {/* Token Selector Modals */}
      {showFromSel && (
        <TokenSelector
          selected={fromToken}
          exclude={toToken}
          balances={balances}
          onSelect={t => { setFromToken(t); setError(''); setTxHash(''); setToAmount('') }}
          onClose={() => setShowFromSel(false)}
          tokens={SWAP_TOKENS}
        />
      )}
      {showToSel && (
        <TokenSelector
          selected={toToken}
          exclude={fromToken}
          balances={balances}
          onSelect={t => { setToToken(t); setError(''); setTxHash(''); setToAmount('') }}
          onClose={() => setShowToSel(false)}
          tokens={SWAP_TOKENS}
        />
      )}
    </div>
  )
}
