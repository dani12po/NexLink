'use client'

import React, { useEffect, useState } from 'react'
import { useWallet } from '@/components/WalletButton'

/* =========================
   Notification System
========================= */
function useToast() {
  const [toasts, setToasts] = React.useState([])

  const push = React.useCallback((toast) => {
    const id = `${Date.now()}-${Math.random()}`
    const ttl = toast.ttlMs ?? 30000
    setToasts((prev) => [{ id, type: 'info', title: '', message: '', actionLabel: '', actionHref: '', ttl, ...toast }, ...prev].slice(0, 3))
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), ttl)
  }, [])

  const remove = React.useCallback((id) => {
    setToasts((prev) => prev.filter((x) => x.id !== id))
  }, [])

  return { toasts, push, remove }
}

function ToastStack({ toasts, onClose }) {
  return (
    <div className="fixed top-4 right-4 z-[9999] space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`w-[320px] rounded-xl border px-4 py-3 backdrop-blur bg-zinc-950/85 shadow-lg ${
            t.type === 'success' ? 'border-emerald-800'
            : t.type === 'error' ? 'border-red-900'
            : 'border-zinc-800'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {t.title   && <div className="text-sm font-semibold text-zinc-100">{t.title}</div>}
              {t.message && <div className="text-xs text-zinc-300 mt-1 break-words">{t.message}</div>}
              {t.actionHref && (
                <a href={t.actionHref} target="_blank" rel="noreferrer"
                  className="inline-block text-xs mt-2 underline text-zinc-200 hover:text-white">
                  {t.actionLabel || 'Open'}
                </a>
              )}
            </div>
            <button type="button" onClick={() => onClose(t.id)}
              className="text-zinc-500 hover:text-zinc-200 text-sm leading-none" aria-label="Close">
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function maskTx(hash) {
  if (!hash) return ''
  const s = String(hash)
  return s.length <= 20 ? s : `${s.slice(0, 10)}...${s.slice(-8)}`
}

/* =========================
   Free Claim Page
========================= */
export default function Page() {
  const { toasts, push, remove } = useToast()
  const { address: connectedAddress } = useWallet()

  const [freeWallet,          setFreeWallet]          = useState('')
  const [freeMsg,             setFreeMsg]             = useState('')
  const [freeBusy,            setFreeBusy]            = useState(false)
  const [freeCountdown,       setFreeCountdown]       = useState(0)
  const [freeFollowConfirmed, setFreeFollowConfirmed] = useState(false)
  const [freeFollowEnabled,   setFreeFollowEnabled]   = useState(false)

  // Auto-fill wallet dari connected wallet
  useEffect(() => {
    if (connectedAddress && !freeWallet) {
      setFreeWallet(connectedAddress)
    }
  }, [connectedAddress])

  // Countdown tick
  useEffect(() => {
    if (freeCountdown <= 0) return
    const t = setInterval(() => setFreeCountdown((c) => (c <= 1 ? 0 : c - 1)), 1000)
    return () => clearInterval(t)
  }, [freeCountdown])

  // Check cooldown when a valid address is pasted
  useEffect(() => {
    if (!freeWallet || !/^0x[a-f0-9]{40}$/i.test(freeWallet)) {
      setFreeCountdown(0)
      return
    }
    fetch('/api/free-claim/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: freeWallet.toLowerCase() }),
    })
      .then((r) => r.json())
      .then((d) => setFreeCountdown(d.remaining > 0 ? Math.ceil(d.remaining / 1000) : 0))
      .catch(() => setFreeCountdown(0))
  }, [freeWallet])

  // Auto-enable checkbox 10s after clicking follow link
  useEffect(() => {
    if (!freeFollowEnabled) return
    const t = setTimeout(() => setFreeFollowConfirmed(true), 10000)
    return () => clearTimeout(t)
  }, [freeFollowEnabled])

  async function freeClaim() {
    if (!freeWallet.trim())      { setFreeMsg('Please enter a wallet address.'); return }
    if (!freeFollowConfirmed)    { setFreeMsg('Please confirm you followed first.'); return }

    setFreeBusy(true)
    setFreeMsg('')

    try {
      const res  = await fetch('/api/free-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: freeWallet.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.error === 'Cooldown active' && data.remaining) {
          setFreeCountdown(Math.ceil(data.remaining / 1000))
          push({
            type: 'error',
            title: 'Cooldown Active',
            message: `Wait ${Math.floor(data.remaining / 3600000)}h ${Math.floor((data.remaining % 3600000) / 60000)}m more.`,
            ttlMs: 30000,
          })
        } else {
          setFreeMsg(data.error || 'Error')
        }
        setFreeBusy(false)
        return
      }

      push({
        type: 'success',
        title: 'Claim success!',
        message: `Tx: ${maskTx(data.txHash)}`,
        actionLabel: 'View on ArcScan',
        actionHref: `https://testnet.arcscan.app/tx/${data.txHash}`,
        ttlMs: 30000,
      })
      setFreeWallet('')
      setFreeCountdown(0)
      setFreeFollowConfirmed(false)
      setFreeFollowEnabled(false)
      setTimeout(() => setFreeBusy(false), 10000)
    } catch {
      setFreeMsg('Network error')
      setFreeBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 56px)',
        padding: '24px',
      }}
    >
      <ToastStack toasts={toasts} onClose={remove} />

      {/* Free Claim — no card wrapper, direct render */}
      <div style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <h2 className="text-2xl font-semibold tracking-tight">Free Claim</h2>
        <p className="text-xs text-zinc-400 mt-2">
          Follow → Paste Wallet → 5 USDC / 2 Hour
        </p>

        {/* Follow button */}
        <a
          href="https://twitter.com/intent/follow?screen_name=Iq_dani26"
          target="_blank"
          rel="noreferrer"
          onClick={() => setFreeFollowEnabled(true)}
          className="inline-block mt-6 px-5 py-2.5 rounded-xl border border-emerald-800 bg-emerald-500/10 hover:bg-emerald-500/15 hover:shadow-lg hover:shadow-emerald-500/40 text-sm font-semibold transition-all duration-200"
        >
          Follow Dani.xyz
        </a>

        {/* Inputs */}
        <div className="mt-5 flex flex-col items-center gap-3">
          <div className="w-full relative">
            <input
              value={freeWallet}
              onChange={(e) => setFreeWallet(e.target.value)}
              placeholder="Paste wallet address"
              readOnly={Boolean(connectedAddress)}
              className={`w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-colors ${
                connectedAddress
                  ? 'border-emerald-800/50 bg-emerald-500/5 text-emerald-300 cursor-default'
                  : 'border-zinc-800 bg-black/30 focus:border-zinc-600'
              }`}
            />
            {connectedAddress && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-500/70">
                ✓ wallet
              </span>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-300 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={freeFollowConfirmed}
              onChange={(e) => setFreeFollowConfirmed(e.target.checked)}
              disabled={!freeFollowEnabled}
              className="accent-emerald-500"
            />
            I followed
          </label>

          <button
            onClick={freeClaim}
            disabled={freeBusy || freeCountdown > 0 || !freeFollowConfirmed}
            className="w-full px-4 py-2.5 rounded-xl border border-sky-800 bg-sky-500/10 hover:bg-sky-500/15 hover:shadow-lg hover:shadow-sky-500/40 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
          >
            {freeCountdown > 0
              ? `Cooldown: ${Math.floor(freeCountdown / 3600)}h ${Math.floor((freeCountdown % 3600) / 60)}m ${freeCountdown % 60}s`
              : freeBusy
              ? 'Sending…'
              : 'Claim 5 USDC'}
          </button>

          {freeMsg && (
            <p className="text-xs text-red-400 break-all">{freeMsg}</p>
          )}
        </div>

        {/* Link ke Bridge */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <a
            href="/dapp?tab=bridge"
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'underline' }}
          >
            Bridge USDC Sepolia ↔ Arc →
          </a>
        </div>
      </div>
    </div>
  )
}
