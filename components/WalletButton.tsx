/**
 * components/WalletButton.tsx
 * Wallet connect/disconnect + useWallet hook.
 *
 * Support: MetaMask, Rabby, OKX, Trust, dan semua EIP-1193 wallet via EIP-6963.
 *
 * ARSITEKTUR:
 * - connect/disconnect didefinisikan di module level (bukan di dalam component)
 * - Sehingga useWallet() dari HeaderWallet bisa langsung pakai tanpa WalletButton di-mount
 */
'use client'

import React, { useState, useEffect } from 'react'
import { ARC_CHAIN_ID, SEPOLIA_CHAIN_ID } from '@/lib/arcChain'
import {
  getEvmProvider, initEIP6963, getEIP6963Providers,
  type WalletProvider,
} from '@/lib/evmProvider'

export interface WalletState {
  address:      string | null
  chainId:      number | null
  connected:    boolean
  isConnecting: boolean
  connect:      () => Promise<void>
  disconnect:   () => void
}

// ── Singleton state ────────────────────────────────────────────────────────
let _listeners: Array<(s: WalletState) => void> = []
let _addrRef:    string | null = null
let _chainIdRef: number | null = null
let _providerRef: any = null

function notify(patch: Partial<WalletState>) {
  _state = { ..._state, ...patch }
  _listeners.forEach(fn => fn(_state))
}

function syncWalletState(addr: string | null, cid: number | null) {
  _addrRef    = addr
  _chainIdRef = cid
  notify({ address: addr, chainId: cid, connected: !!addr, isConnecting: false })
}

// ── Module-level connect/disconnect (tidak butuh component mount) ──────────
async function connectWithProvider(provider: any): Promise<void> {
  if (!provider) return
  notify({ isConnecting: true })

  // Setup event listeners
  const onAccounts = (accounts: string[]) => syncWalletState(accounts[0] ?? null, _chainIdRef)
  const onChain    = (hex: string)        => syncWalletState(_addrRef, parseInt(hex, 16))

  if (_providerRef && _providerRef !== provider) {
    _providerRef.removeListener?.('accountsChanged', onAccounts)
    _providerRef.removeListener?.('chainChanged',    onChain)
  }
  _providerRef = provider
  provider.on?.('accountsChanged', onAccounts)
  provider.on?.('chainChanged',    onChain)

  try {
    const accs = await provider.request({ method: 'eth_requestAccounts' })
    const hex  = await provider.request({ method: 'eth_chainId' })
    syncWalletState(accs[0] ?? null, parseInt(hex, 16))
  } catch { /* user rejected */
    notify({ isConnecting: false })
  }
}

// Expose sebagai module-level function
let _showPickerFn: ((wallets: WalletProvider[]) => void) | null = null

async function connectWallet(): Promise<void> {
  // Init EIP-6963 jika belum
  if (typeof window !== 'undefined') {
    initEIP6963()
    await new Promise(r => setTimeout(r, 100)) // beri waktu wallet announce
  }

  const detected = getEIP6963Providers()

  if (detected.length === 0) {
    const eth = getEvmProvider()
    if (!eth) {
      alert('Wallet tidak ditemukan.\n\nInstall salah satu:\n• MetaMask (metamask.io)\n• Rabby (rabby.io)\n• OKX Wallet\n• Trust Wallet')
      return
    }
    await connectWithProvider(eth)
    return
  }

  if (detected.length === 1) {
    await connectWithProvider(detected[0].provider)
    return
  }

  // Multiple wallets — tampilkan picker via callback
  if (_showPickerFn) {
    _showPickerFn(detected)
  } else {
    // Fallback: pakai yang pertama
    await connectWithProvider(detected[0].provider)
  }
}

function disconnectWallet(): void {
  _addrRef    = null
  _chainIdRef = null
  const provider = _providerRef ?? getEvmProvider()
  if (provider) {
    provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
      .catch(() => {})
  }
  syncWalletState(null, null)
}

// ── Initial state dengan fungsi yang benar ─────────────────────────────────
let _state: WalletState = {
  address: null, chainId: null, connected: false, isConnecting: false,
  connect:    connectWallet,
  disconnect: disconnectWallet,
}

// ── useWallet hook ─────────────────────────────────────────────────────────
export function useWallet(): WalletState {
  // Selalu mulai dengan state default (null address) untuk SSR consistency
  const [state, setState] = useState<WalletState>(() => ({
    address: null, chainId: null, connected: false, isConnecting: false,
    connect:    connectWallet,
    disconnect: disconnectWallet,
  }))

  useEffect(() => {
    // Setelah mount (client-only), sync dengan state terkini
    setState(_state)
    _listeners.push(setState)
    return () => { _listeners = _listeners.filter(fn => fn !== setState) }
  }, [])

  return state
}

// ── Init wallet detection saat module load ─────────────────────────────────
if (typeof window !== 'undefined') {
  // Jalankan setelah hydration
  setTimeout(() => {
    initEIP6963()
    const eth = getEvmProvider()
    if (!eth) return
    // Silent check — tidak popup
    eth.request({ method: 'eth_accounts' })
      .then((accs: string[]) => {
        if (accs?.[0]) {
          eth.request({ method: 'eth_chainId' }).then((hex: string) => {
            _providerRef = eth
            syncWalletState(accs[0], parseInt(hex, 16))
          }).catch(() => {})
        }
      })
      .catch(() => {})
    // Event listeners
    eth.on?.('accountsChanged', (accs: string[]) => syncWalletState(accs[0] ?? null, _chainIdRef))
    eth.on?.('chainChanged',    (hex: string)    => syncWalletState(_addrRef, parseInt(hex, 16)))
  }, 0)
}

// ── Wallet Picker Modal ────────────────────────────────────────────────────
function WalletIcon({ icon, name }: { icon: string; name: string }) {
  if (icon) return <img src={icon} alt={name} width={28} height={28} className="rounded-lg" />
  return (
    <div className="w-7 h-7 rounded-lg bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300">
      {name[0]}
    </div>
  )
}

function WalletPicker({ wallets, onSelect, onClose }: {
  wallets: WalletProvider[]
  onSelect: (provider: any) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xs rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-200">Pilih Wallet</h3>
          <button type="button" onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors text-lg leading-none">✕</button>
        </div>
        <div className="space-y-2">
          {wallets.map(w => (
            <button key={w.info.uuid} type="button" onClick={() => onSelect(w.provider)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-zinc-700 transition-all text-left">
              <WalletIcon icon={w.info.icon} name={w.info.name} />
              <span className="text-sm text-zinc-200 font-medium">{w.info.name}</span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs text-zinc-600 text-center">
          MetaMask · Rabby · OKX · Trust · dan semua EIP-1193 wallet
        </p>
      </div>
    </div>
  )
}

// ── WalletButton component — hanya untuk render picker modal ──────────────
// Komponen ini WAJIB di-mount di layout agar picker bisa tampil
export default function WalletButton() {
  const [pickerWallets, setPickerWallets] = useState<WalletProvider[]>([])
  const [showPicker,    setShowPicker]    = useState(false)

  // Register picker callback ke module level
  useEffect(() => {
    _showPickerFn = (wallets) => {
      setPickerWallets(wallets)
      setShowPicker(true)
    }
    return () => { _showPickerFn = null }
  }, [])

  if (!showPicker) return null

  return (
    <WalletPicker
      wallets={pickerWallets}
      onSelect={async (provider) => {
        setShowPicker(false)
        await connectWithProvider(provider)
      }}
      onClose={() => setShowPicker(false)}
    />
  )
}
