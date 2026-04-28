'use client'
/**
 * components/ClaimCard.tsx
 * Card UI untuk Free Claim dan Paid Claim flow.
 * Dipakai oleh: app/claim/page.jsx, app/page.jsx
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useWallet } from './WalletButton'

// ─── Types ────────────────────────────────────────────────────────────────────
export type ClaimMode = 'free' | 'paid'

export interface ClaimCardProps {
  mode?: ClaimMode
  /** Override reward amount label */
  rewardLabel?: string
  /** Twitter/X profile URL untuk follow gate */
  twitterUrl?: string
  /** Twitter handle untuk display */
  twitterHandle?: string
  /** Callback saat claim berhasil */
  onSuccess?: (txHash: string) => void
  /** Callback saat error */
  onError?: (msg: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function maskTx(hash: string) {
  if (!hash) return ''
  return hash.length <= 20 ? hash : `${hash.slice(0, 10)}...${hash.slice(-8)}`
}

function fmtCountdown(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// ─── ClaimCard ────────────────────────────────────────────────────────────────
export function ClaimCard({
  mode          = 'free',
  rewardLabel   = '5 USDC',
  twitterUrl    = 'https://twitter.com/intent/follow?screen_name=Iq_dani26',
  twitterHandle = '@Iq_dani26',
  onSuccess,
  onError,
}: ClaimCardProps) {
  const { address: connectedAddress } = useWallet()

  const [mounted,         setMounted]         = useState(false)
  const [wallet,          setWallet]          = useState('')
  const [busy,            setBusy]            = useState(false)
  const [msg,             setMsg]             = useState('')
  const [txHash,          setTxHash]          = useState('')
  const [countdown,       setCountdown]       = useState(0)
  const [followEnabled,   setFollowEnabled]   = useState(false)
  const [followConfirmed, setFollowConfirmed] = useState(false)

  // Mount guard — hindari hydration mismatch
  useEffect(() => { setMounted(true) }, [])

  // Auto-fill dari connected wallet
  useEffect(() => {
    if (connectedAddress && !wallet) setWallet(connectedAddress)
  }, [connectedAddress, wallet])

  // Countdown tick
  useEffect(() => {
    if (countdown <= 0) return
    const t = setInterval(() => setCountdown(c => (c <= 1 ? 0 : c - 1)), 1000)
    return () => clearInterval(t)
  }, [countdown])

  // Cek cooldown saat wallet berubah (free claim only)
  useEffect(() => {
    if (mode !== 'free') return
    if (!wallet || !/^0x[a-f0-9]{40}$/i.test(wallet)) { setCountdown(0); return }
    fetch('/api/free-claim/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: wallet.toLowerCase() }),
    })
      .then(r => r.json())
      .then(d => setCountdown(d.remaining > 0 ? Math.ceil(d.remaining / 1000) : 0))
      .catch(() => setCountdown(0))
  }, [wallet, mode])

  // Auto-enable follow checkbox 10s setelah klik link
  useEffect(() => {
    if (!followEnabled) return
    const t = setTimeout(() => setFollowConfirmed(true), 10_000)
    return () => clearTimeout(t)
  }, [followEnabled])

  const handleClaim = useCallback(async () => {
    if (!wallet.trim()) { setMsg('Masukkan wallet address.'); return }
    if (mode === 'free' && !followConfirmed) { setMsg('Konfirmasi follow terlebih dahulu.'); return }

    setBusy(true); setMsg(''); setTxHash('')

    try {
      const endpoint = mode === 'free' ? '/api/free-claim' : '/api/faucet'
      const res  = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: wallet.trim().toLowerCase() }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.remaining) setCountdown(Math.ceil(data.remaining / 1000))
        const errMsg = data.error || 'Error'
        setMsg(errMsg)
        onError?.(errMsg)
        setBusy(false)
        return
      }

      const hash = data.txHash || data.hash || ''
      setTxHash(hash)
      setMsg('')
      onSuccess?.(hash)

      // Reset follow state
      setFollowConfirmed(false)
      setFollowEnabled(false)
      setTimeout(() => setBusy(false), 5_000)
    } catch {
      const errMsg = 'Network error'
      setMsg(errMsg)
      onError?.(errMsg)
      setBusy(false)
    }
  }, [wallet, mode, followConfirmed, onSuccess, onError])

  const isDisabled = busy || countdown > 0 || (mode === 'free' && !followConfirmed)

  return (
    <div className="w-full max-w-sm mx-auto space-y-4">
      {/* Follow gate (free claim only) */}
      {mode === 'free' && (
        <div className="space-y-3">
          <a
            href={twitterUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => setFollowEnabled(true)}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-sky-800 bg-sky-500/10 hover:bg-sky-500/15 text-sm font-semibold transition-all duration-200"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            Follow {twitterHandle}
          </a>

          <label className="flex items-center gap-2 text-sm text-zinc-300 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={followConfirmed}
              onChange={e => setFollowConfirmed(e.target.checked)}
              disabled={!followEnabled}
              className="accent-emerald-500 w-4 h-4"
            />
            Saya sudah follow
          </label>
        </div>
      )}

      {/* Wallet input */}
      <div className="relative">
        <input
          value={wallet}
          onChange={e => setWallet(e.target.value)}
          placeholder="Paste wallet address (0x...)"
          readOnly={mounted && Boolean(connectedAddress)}
          className={`w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-colors ${
            mounted && connectedAddress
              ? 'border-emerald-800/50 bg-emerald-500/5 text-emerald-300 cursor-default'
              : 'border-zinc-800 bg-black/30 focus:border-zinc-600'
          }`}
        />
        {mounted && connectedAddress && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-500/70">
            ✓ connected
          </span>
        )}
      </div>

      {/* Claim button */}
      <button
        type="button"
        onClick={handleClaim}
        disabled={isDisabled}
        className="w-full px-4 py-3 rounded-xl border border-emerald-800 bg-emerald-500/10 hover:bg-emerald-500/15 hover:shadow-lg hover:shadow-emerald-500/30 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
      >
        {countdown > 0
          ? `Cooldown: ${fmtCountdown(countdown)}`
          : busy
          ? 'Mengirim…'
          : `Claim ${rewardLabel}`}
      </button>

      {/* Error message */}
      {msg && !txHash && (
        <p className="text-xs text-red-400 text-center break-all">{msg}</p>
      )}

      {/* Success */}
      {txHash && (
        <div className="rounded-xl border border-emerald-800/50 bg-emerald-500/5 p-3 space-y-1.5">
          <p className="text-xs text-emerald-400 font-semibold">✅ Claim berhasil!</p>
          <p className="text-xs text-zinc-400 font-mono break-all">{maskTx(txHash)}</p>
          <a
            href={`https://testnet.arcscan.app/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="block text-xs text-emerald-400 underline hover:text-emerald-300"
          >
            Lihat di ArcScan →
          </a>
        </div>
      )}
    </div>
  )
}

export default ClaimCard
