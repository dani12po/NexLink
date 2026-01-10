'use client'

import React from 'react'
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEther,
  parseUnits,
  erc20Abi,
} from 'viem'
import { base } from 'viem/chains'

/* =========================
   ENV (frontend)
========================= */
const RPC =
  process.env.NEXT_PUBLIC_BASE_RPC_URL ||
  process.env.NEXT_PUBLIC_BASE_RPC ||
  'https://mainnet.base.org'

const TREASURY =
  process.env.NEXT_PUBLIC_TREASURY ||
  process.env.NEXT_PUBLIC_TREASURY_BASE_ADDRESS ||
  ''

const USDC =
  process.env.NEXT_PUBLIC_BASE_USDC ||
  process.env.NEXT_PUBLIC_USDC_BASE ||
  ''

const PAY_METHOD = process.env.NEXT_PUBLIC_PAY_METHOD || 'BOTH'
const PAY_USDC =
  process.env.NEXT_PUBLIC_PAY_USDC ||
  process.env.NEXT_PUBLIC_PAYMENT_USDC ||
  '0.10'
const PAY_ETH = process.env.NEXT_PUBLIC_PAY_ETH || '0.00005'
const REWARD_USDC = process.env.NEXT_PUBLIC_REWARD_USDC || '10'

const TARGET_HANDLE =
  (process.env.NEXT_PUBLIC_X_TARGET_HANDLE || '@Iq_dani26').replace(/^@/, '')
const TARGET_PROFILE_URL =
  process.env.NEXT_PUBLIC_X_TARGET_PROFILE_URL || `https://x.com/${TARGET_HANDLE}`

const BASE_CHAIN_ID_DEC = 8453
const BASE_CHAIN_ID_HEX = '0x2105'

const baseClient = createPublicClient({
  chain: base,
  transport: http(RPC),
})

/* =========================
   Helpers
========================= */
function maskTx(hash) {
  if (!hash) return ''
  const s = String(hash)
  if (s.length <= 20) return s
  return `${s.slice(0, 10)}...${s.slice(-8)}`
}

async function switchToBase() {
  // @ts-ignore
  const eth = window.ethereum
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BASE_CHAIN_ID_HEX }],
    })
    return true
  } catch (e) {
    if (e?.code === 4902) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: BASE_CHAIN_ID_HEX,
            chainName: 'Base',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: [RPC],
            blockExplorerUrls: ['https://basescan.org'],
          },
        ],
      })
      return true
    }
    throw e
  }
}

async function waitConfirm(hash) {
  await baseClient.waitForTransactionReceipt({ hash, confirmations: 1 })
}

/* =========================
   Notification System (top-right)
========================= */
function useToast() {
  const [toasts, setToasts] = React.useState([])

  const push = React.useCallback((toast) => {
    const id = `${Date.now()}-${Math.random()}`
    const ttl = toast.ttlMs ?? 30000
    const item = {
      id,
      type: toast.type || 'info',
      title: toast.title || '',
      message: toast.message || '',
      actionLabel: toast.actionLabel || '',
      actionHref: toast.actionHref || '',
      ttl,
    }
    setToasts((prev) => [item, ...prev].slice(0, 3))

    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id))
    }, ttl)
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
            t.type === 'success'
              ? 'border-emerald-800'
              : t.type === 'error'
              ? 'border-red-900'
              : 'border-zinc-800'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {t.title ? (
                <div className="text-sm font-semibold text-zinc-100">{t.title}</div>
              ) : null}
              {t.message ? (
                <div className="text-xs text-zinc-300 mt-1 break-words">{t.message}</div>
              ) : null}

              {t.actionHref ? (
                <a
                  href={t.actionHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs mt-2 underline text-zinc-200 hover:text-white"
                >
                  {t.actionLabel || 'Open'}
                </a>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => onClose(t.id)}
              className="text-zinc-500 hover:text-zinc-200 text-sm leading-none"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* =========================
   Page
========================= */
export default function Page() {
  const { toasts, push, remove } = useToast()

  const [mounted, setMounted] = React.useState(false)
  const [providerDetected, setProviderDetected] = React.useState(false)

  const [address, setAddress] = React.useState(null)
  const [chainId, setChainId] = React.useState(null)
  const isOnBase = chainId === BASE_CHAIN_ID_DEC

  const [busy, setBusy] = React.useState(false)

  const [paid, setPaid] = React.useState(false)
  const [cooldown, setCooldown] = React.useState(0) // <- FIX: pure countdown state (no unlockAt)

  const [paymentTx, setPaymentTx] = React.useState(null)
  const [arcTx, setArcTx] = React.useState(null)

  const [twitterUsername, setTwitterUsername] = React.useState('')
  const [followConfirmed, setFollowConfirmed] = React.useState(false)
  const [followSubmitted, setFollowSubmitted] = React.useState(false)

  const followEnabled = paid && cooldown === 0
  const canSubmitFollow = followEnabled && followConfirmed && twitterUsername.trim().length >= 2
  const canClaim = followEnabled && followSubmitted

  // mount + provider detect (avoid hydration mismatch)
  React.useEffect(() => {
    setMounted(true)
    setProviderDetected(typeof window !== 'undefined' && typeof window.ethereum !== 'undefined')
  }, [])

  const refreshWalletState = React.useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) return
    // @ts-ignore
    const eth = window.ethereum
    const [cid, accounts] = await Promise.all([
      eth.request({ method: 'eth_chainId' }),
      eth.request({ method: 'eth_accounts' }),
    ])
    setChainId(parseInt(cid, 16))
    setAddress(accounts?.[0] || null)
  }, [])

  // sync wallet state (connect happens in header)
  React.useEffect(() => {
    refreshWalletState()

    if (typeof window === 'undefined' || !window.ethereum) return
    // @ts-ignore
    const eth = window.ethereum

    const onAccounts = (accs) => setAddress(accs?.[0] || null)
    const onChain = (cidHex) => setChainId(parseInt(cidHex, 16))

    eth.on?.('accountsChanged', onAccounts)
    eth.on?.('chainChanged', onChain)

    return () => {
      eth.removeListener?.('accountsChanged', onAccounts)
      eth.removeListener?.('chainChanged', onChain)
    }
  }, [refreshWalletState])

  // FIX: countdown interval reliable for ETH & USDC
  React.useEffect(() => {
    if (!paid) return
    if (cooldown <= 0) return

    const t = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1))
    }, 1000)

    return () => clearInterval(t)
  }, [paid, cooldown > 0]) // boolean dep => interval tidak restart tiap detik

  // notify when unlocked (only when it transitions >0 -> 0)
  const prevCooldownRef = React.useRef(0)
  React.useEffect(() => {
    if (paid && prevCooldownRef.current > 0 && cooldown === 0) {
      push({ type: 'success', title: 'Unlocked', message: 'Follow & claim is enabled.', ttlMs: 30000 })
    }
    prevCooldownRef.current = cooldown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooldown, paid])

  async function ensureBase() {
    await switchToBase()
    await refreshWalletState()
  }

  async function afterConfirmed(hash) {
    // reset follow states whenever new payment happens
    setPaid(true)
    setCooldown(10) // <- start countdown immediately (no race condition)
    setFollowConfirmed(false)
    setFollowSubmitted(false)
    setTwitterUsername('')
    setArcTx(null)

    push({
      type: 'success',
      title: 'Payment confirmed',
      message: `Tx: ${maskTx(hash)}`,
      actionLabel: 'View on BaseScan',
      actionHref: `https://basescan.org/tx/${hash}`,
      ttlMs: 30000,
    })
  }

  async function payWithUSDC() {
    setBusy(true)
    try {
      if (!providerDetected) throw new Error('Wallet not detected.')
      if (!address) throw new Error('Connect wallet (top-right) first.')
      if (!TREASURY || !USDC) throw new Error('Missing env: NEXT_PUBLIC_TREASURY / NEXT_PUBLIC_BASE_USDC')
      if (!isOnBase) await ensureBase()

      // @ts-ignore
      const eth = window.ethereum
      const walletClient = createWalletClient({ chain: base, transport: custom(eth) })

      const hash = await walletClient.writeContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [TREASURY, parseUnits(String(PAY_USDC), 6)],
        account: address,
      })

      setPaymentTx(hash)
      push({ type: 'info', title: 'Payment sent', message: `Waiting confirm… ${maskTx(hash)}`, ttlMs: 30000 })
      await waitConfirm(hash)
      await afterConfirmed(hash)
    } catch (e) {
      push({ type: 'error', title: 'Payment failed', message: e?.shortMessage || e?.message || 'USDC payment failed' })
    } finally {
      setBusy(false)
    }
  }

  async function payWithETH() {
    setBusy(true)
    try {
      if (!providerDetected) throw new Error('Wallet not detected.')
      if (!address) throw new Error('Connect wallet (top-right) first.')
      if (!TREASURY) throw new Error('Missing env: NEXT_PUBLIC_TREASURY')
      if (!isOnBase) await ensureBase()

      // @ts-ignore
      const eth = window.ethereum
      const walletClient = createWalletClient({ chain: base, transport: custom(eth) })

      const hash = await walletClient.sendTransaction({
        to: TREASURY,
        value: parseEther(String(PAY_ETH)),
        account: address,
      })

      setPaymentTx(hash)
      push({ type: 'info', title: 'Payment sent', message: `Waiting confirm… ${maskTx(hash)}`, ttlMs: 30000 })
      await waitConfirm(hash)
      await afterConfirmed(hash)
    } catch (e) {
      push({ type: 'error', title: 'Payment failed', message: e?.shortMessage || e?.message || 'ETH payment failed' })
    } finally {
      setBusy(false)
    }
  }

  function submitFollow() {
    const u = twitterUsername.trim().replace(/^@/, '')
    if (!followConfirmed) {
      push({ type: 'error', title: 'Follow not confirmed', message: 'Tick "I followed" first.' })
      return
    }
    if (u.length < 2) {
      push({ type: 'error', title: 'Username required', message: 'Please input your X username.' })
      return
    }

    setFollowSubmitted(true)
    push({ type: 'success', title: 'Follow submitted', message: `@${u}`, ttlMs: 30000 })
  }

  async function claim() {
    setBusy(true)
    try {
      if (!address) throw new Error('Connect wallet (top-right) first.')
      if (!paymentTx) throw new Error('Pay first.')
      if (!followSubmitted) throw new Error('Complete follow + submit username first.')

      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: address,
          txHash: paymentTx,
          twitterUsername: twitterUsername.trim().replace(/^@/, ''),
        }),
      })

      const j = await res.json()
      if (!j.ok) throw new Error(j.error || 'Claim failed')

      const arcHash = j.arcTxHash || null
      setArcTx(arcHash)

      push({
        type: 'success',
        title: j.alreadyClaimed ? 'Already claimed' : 'Claim success',
        message: arcHash ? `Arc Tx: ${maskTx(arcHash)}` : 'Reward sent.',
        actionLabel: arcHash ? 'View on ArcScan' : '',
        actionHref: arcHash ? `https://testnet.arcscan.app/tx/${arcHash}` : '',
        ttlMs: 30000,
      })
    } catch (e) {
      push({ type: 'error', title: 'Claim failed', message: e?.message || 'Claim failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[70vh]">
      <ToastStack toasts={toasts} onClose={remove} />

      {/* Center title */}
      <div className="mt-10 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Arc Faucet</h1>
        <p className="text-sm text-zinc-400 mt-2">
          Pay on Base → Follow on X → Receive <b>{REWARD_USDC} USDC</b> on Arc Testnet
        </p>

        <div className="text-xs text-zinc-500 mt-2">
          Provider: {mounted ? (providerDetected ? 'Detected' : 'Not detected') : '...'}
        </div>
      </div>

      {/* Pay buttons centered */}
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        {(PAY_METHOD === 'BOTH' || PAY_METHOD === 'USDC') && (
          <button
            type="button"
            onClick={payWithUSDC}
            disabled={busy || !address}
            className="px-4 py-2 rounded-xl border border-emerald-800 bg-emerald-500/10 hover:bg-emerald-500/15 text-sm font-semibold disabled:opacity-50"
          >
            Pay {PAY_USDC} USDC
          </button>
        )}

        {(PAY_METHOD === 'BOTH' || PAY_METHOD === 'ETH') && (
          <button
            type="button"
            onClick={payWithETH}
            disabled={busy || !address}
            className="px-4 py-2 rounded-xl border border-sky-800 bg-sky-500/10 hover:bg-sky-500/15 text-sm font-semibold disabled:opacity-50"
          >
            Pay {PAY_ETH} ETH
          </button>
        )}
      </div>

      {!address && (
        <div className="mt-3 text-center text-xs text-zinc-500">
          Connect wallet from the top-right button.
        </div>
      )}

      {/* Cooldown */}
      {paid && cooldown > 0 && (
        <div className="mt-3 text-center text-xs text-amber-300">
          Waiting {cooldown}s to unlock follow…
        </div>
      )}

      {/* Follow section: only after unlocked */}
      {followEnabled && (
        <div className="mt-10 flex flex-col items-center gap-3">
          <a
            href={TARGET_PROFILE_URL}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-xl border border-zinc-800 bg-white/10 hover:bg-white/15 text-sm font-semibold"
          >
            Follow @{TARGET_HANDLE}
          </a>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <input
              value={twitterUsername}
              onChange={(e) => setTwitterUsername(e.target.value)}
              placeholder="your username (no @)"
              className="w-[240px] px-3 py-2 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600"
            />

            <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
              <input
                type="checkbox"
                checked={followConfirmed}
                onChange={(e) => setFollowConfirmed(e.target.checked)}
              />
              I followed
            </label>

            <button
              type="button"
              onClick={submitFollow}
              disabled={!canSubmitFollow}
              className="px-4 py-2 rounded-xl border border-zinc-800 bg-white/10 hover:bg-white/15 text-sm font-semibold disabled:opacity-50"
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* Claim: only after follow submitted */}
      {followEnabled && followSubmitted && (
        <div className="mt-10 text-center">
          <button
            type="button"
            onClick={claim}
            disabled={busy}
            className="px-4 py-2 rounded-xl border border-zinc-800 bg-white/10 hover:bg-white/15 text-sm font-semibold disabled:opacity-50"
          >
            Claim {REWARD_USDC} USDC (Arc Testnet)
          </button>

          {arcTx ? (
            <div className="mt-3 text-xs text-zinc-400">
              Arc Tx:{' '}
              <a
                className="underline hover:text-white"
                href={`https://testnet.arcscan.app/tx/${arcTx}`}
                target="_blank"
                rel="noreferrer"
              >
                {maskTx(arcTx)}
              </a>
            </div>
          ) : null}
        </div>
      )}

      {followEnabled && !followSubmitted && (
        <div className="mt-8 text-center text-xs text-zinc-500">
          Complete follow step then click <b>Submit</b> to unlock claim.
        </div>
      )}
    </div>
  )
}
