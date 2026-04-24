/**
 * components/WalletButton.tsx
 * Wallet connect button — EIP-6963 safe, no window.ethereum direct access
 */
'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { ARC_CHAIN_ID_HEX, ARC_RPC, ARC_EXPLORER, ARC_CHAIN_ID } from '@/lib/arcChain'
import { getEvmProvider, NO_WALLET_MSG } from '@/lib/evmProvider'

interface WalletState {
  address: string | null
  chainId: number | null
  connected: boolean
  walletProvider: string | null
  isSupportedChain: boolean
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function detectWalletProvider(eth: any): string | null {
  if (!eth) return null
  if (eth.isMetaMask) return 'MetaMask'
  if (eth.isCoinbaseWallet) return 'Coinbase Wallet'
  if (eth.isTrust) return 'Trust Wallet'
  if (eth.isOpera) return 'Opera Wallet'
  if (eth.isBraveWallet) return 'Brave Wallet'
  if (eth.isPhantom) return 'Phantom'
  if (eth.providers) {
    const wcProvider = eth.providers.find((p: any) => p.isWalletConnect)
    if (wcProvider) return 'WalletConnect'
  }
  return 'Unknown EVM Wallet'
}

function isSupportedChain(chainId: number | null): boolean {
  if (!chainId) return false
  return chainId === ARC_CHAIN_ID || chainId === 11155111
}

function getChainName(id: number | null) {
  if (!id) return ''
  if (id === ARC_CHAIN_ID) return 'Arc Testnet'
  if (id === 11155111) return 'Sepolia'
  if (id === 1) return 'Ethereum Mainnet'
  if (id === 8453) return 'Base'
  if (id === 137) return 'Polygon'
  if (id === 42161) return 'Arbitrum One'
  if (id === 10) return 'Optimism'
  if (id === 56) return 'BNB Smart Chain'
  if (id === 43114) return 'Avalanche C-Chain'
  return `Chain ${id}`
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null, chainId: null, connected: false,
    walletProvider: null, isSupportedChain: false,
  })
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)

    const syncWallet = async () => {
      const eth = getEvmProvider()
      if (!eth) return
      try {
        const [cid, accs] = await Promise.all([
          eth.request({ method: 'eth_chainId' }),
          eth.request({ method: 'eth_accounts' }),
        ])
        const provider = detectWalletProvider(eth)
        const chainIdNum = parseInt(cid, 16)
        setState({
          address: accs?.[0] ?? null,
          chainId: chainIdNum,
          connected: !!accs?.[0],
          walletProvider: provider,
          isSupportedChain: isSupportedChain(chainIdNum),
        })
      } catch { /* ignore */ }
    }

    // Sync segera
    syncWallet()

    // Retry setelah 500ms — OKX/Rabby kadang lambat inject provider
    const retryTimer = setTimeout(syncWallet, 500)
    // Retry lagi setelah 1.5s untuk wallet yang sangat lambat
    const retryTimer2 = setTimeout(syncWallet, 1500)

    const eth = getEvmProvider()
    if (!eth) return

    const onAccounts = (accs: string[]) =>
      setState(s => ({ ...s, address: accs?.[0] ?? null, connected: !!accs?.[0] }))
    const onChain = (cid: string) => {
      const chainIdNum = parseInt(cid, 16)
      setState(s => ({ ...s, chainId: chainIdNum, isSupportedChain: isSupportedChain(chainIdNum) }))
    }

    eth.on?.('accountsChanged', onAccounts)
    eth.on?.('chainChanged', onChain)

    // EIP-6963: re-sync saat provider baru announce dirinya
    const onAnnounce = () => { syncWallet() }
    window.addEventListener('eip6963:announceProvider', onAnnounce)

    return () => {
      clearTimeout(retryTimer)
      clearTimeout(retryTimer2)
      eth.removeListener?.('accountsChanged', onAccounts)
      eth.removeListener?.('chainChanged', onChain)
      window.removeEventListener('eip6963:announceProvider', onAnnounce)
    }
  }, [])

  const connect = useCallback(async () => {
    const eth = getEvmProvider()
    if (!eth) { alert(NO_WALLET_MSG); return }
    const accs = await eth.request({ method: 'eth_requestAccounts' })
    const cid = await eth.request({ method: 'eth_chainId' })
    const provider = detectWalletProvider(eth)
    const chainIdNum = parseInt(cid, 16)
    setState({
      address: accs?.[0] ?? null, chainId: chainIdNum,
      connected: !!accs?.[0], walletProvider: provider,
      isSupportedChain: isSupportedChain(chainIdNum),
    })
  }, [])

  const disconnect = useCallback(() => {
    setState({ address: null, chainId: null, connected: false, walletProvider: null, isSupportedChain: false })
  }, [])

  const switchToArc = useCallback(async () => {
    const eth = getEvmProvider()
    if (!eth) return
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] })
    } catch (e: any) {
      if (e?.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: ARC_CHAIN_ID_HEX,
            chainName: 'Arc Testnet',
            nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
            rpcUrls: [ARC_RPC],
            blockExplorerUrls: [ARC_EXPLORER],
          }],
        })
      }
    }
  }, [])

  return { ...state, mounted, connect, disconnect, switchToArc }
}

export default function WalletButton() {
  const { address, chainId, connected, mounted, connect, disconnect, switchToArc, walletProvider, isSupportedChain } = useWallet()
  const [showMenu, setShowMenu] = useState(false)

  // Single skeleton — no duplicate
  if (!mounted) {
    return <div className="px-4 py-2 rounded-xl border border-zinc-800 bg-white/5 text-sm text-zinc-500 w-32 h-9 animate-pulse" />
  }

  if (!connected || !address) {
    const hasWallet = hasEvmProvider()
    if (!hasWallet) {
      return (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => window.open('https://metamask.io/download/', '_blank')}
            className="px-4 py-2 rounded-xl border border-zinc-700 bg-white/10 hover:bg-white/15 text-sm font-medium transition-colors"
          >
            Install MetaMask
          </button>
          <p className="text-xs text-zinc-500 text-center">Or use any EVM wallet</p>
        </div>
      )
    }
    return (
      <button
        type="button"
        onClick={connect}
        className="px-4 py-2 rounded-xl border border-zinc-700 bg-white/10 hover:bg-white/15 text-sm font-medium transition-colors"
      >
        Connect Wallet
      </button>
    )
  }

  const isArc = chainId === ARC_CHAIN_ID
  const chainName = getChainName(chainId)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowMenu((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-sm transition-colors"
      >
        <span className={`w-2 h-2 rounded-full ${isSupportedChain ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        <span className="text-zinc-200 font-mono">{shortAddr(address)}</span>
        <span className="text-zinc-500 text-xs">{chainName}</span>
        <span className="text-zinc-600 text-xs">▾</span>
      </button>

      {showMenu && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-800">
            <div className="text-xs text-zinc-500">Connected via {walletProvider || 'Unknown'}</div>
            <div className="text-sm font-mono text-zinc-200 mt-0.5">{shortAddr(address)}</div>
            <div className={`text-xs mt-1 ${isSupportedChain ? 'text-emerald-400' : 'text-amber-400'}`}>
              {isSupportedChain ? '✓ Supported network' : '⚠ Unsupported network'}
            </div>
          </div>

          {!isArc && (
            <button
              type="button"
              onClick={() => { switchToArc(); setShowMenu(false) }}
              className="w-full text-left px-3 py-2 text-sm text-amber-300 hover:bg-zinc-900 transition-colors"
            >
              Switch to Arc Testnet
            </button>
          )}

          <a
            href={`${ARC_EXPLORER}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="block px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 transition-colors"
            onClick={() => setShowMenu(false)}
          >
            View on ArcScan ↗
          </a>

          <button
            type="button"
            onClick={() => { disconnect(); setShowMenu(false) }}
            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-zinc-900 transition-colors border-t border-zinc-800"
          >
            Disconnect
          </button>
        </div>
      )}

      {showMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
      )}
    </div>
  )
}

function hasEvmProvider(): boolean {
  if (typeof window === 'undefined') return false
  return getEvmProvider() !== null
}
