'use client'

import React from 'react'
import { createPublicClient, http, formatUnits, erc20Abi } from 'viem'
import { getEvmProvider } from '@/lib/evmProvider'

// ── Constants ────────────────────────────────────────────────────────────────
const ARC_USDC        = '0x3600000000000000000000000000000000000000'
const ARC_RPC         = 'https://rpc.testnet.arc.network'
const ARC_CHAIN_ID    = 5042002
const ARC_CHAIN_ID_HEX = '0x4cef52'  // 5042002 decimal

const NETWORK_LABELS = {
  '0x1':       { label: 'Mainnet',      dot: '#22C55E', testnet: false },
  '0xaa36a7':  { label: 'Sepolia',      dot: '#F59E0B', testnet: true  },
  '0x4cef52':  { label: 'Arc Testnet',  dot: '#F59E0B', testnet: true  },
  '0x2105':    { label: 'Base',         dot: '#22C55E', testnet: false },
}

const arcClient = createPublicClient({
  chain: {
    id: ARC_CHAIN_ID,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
    rpcUrls: { default: { http: [ARC_RPC] } },
  },
  transport: http(ARC_RPC),
})

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ''
}

function formatBalance(raw) {
  if (raw === null) return '—'
  const n = parseFloat(raw)
  if (isNaN(n)) return '—'
  // Show up to 4 decimals, strip trailing zeros
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

// ── Main component ───────────────────────────────────────────────────────────
export default function HeaderWallet() {
  const [mounted,    setMounted]    = React.useState(false)
  const [address,    setAddress]    = React.useState(null)
  const [chainId,    setChainId]    = React.useState(null)   // hex string e.g. '0xaa36a7'
  const [balance,    setBalance]    = React.useState(null)   // formatted string or null
  const [showMenu,   setShowMenu]   = React.useState(false)
  const [copied,     setCopied]     = React.useState(false)

  // ── Wallet sync ────────────────────────────────────────────────────────────
  React.useEffect(() => {
    setMounted(true)

    const syncWallet = async () => {
      const eth = typeof window !== 'undefined' ? getEvmProvider() : null
      if (!eth) return
      try {
        const [accs, cid] = await Promise.all([
          eth.request({ method: 'eth_accounts' }),
          eth.request({ method: 'eth_chainId' }),
        ])
        if (accs?.[0]) setAddress(accs[0])
        if (cid) setChainId(cid)
      } catch { /* ignore */ }
    }

    syncWallet()
    const t1 = setTimeout(syncWallet, 500)
    const t2 = setTimeout(syncWallet, 1500)

    const eth = typeof window !== 'undefined' ? getEvmProvider() : null
    if (!eth) return

    const onAccounts = (accs) => setAddress(accs?.[0] || null)
    const onChain    = (cid)  => setChainId(cid)

    eth.on?.('accountsChanged', onAccounts)
    eth.on?.('chainChanged',    onChain)

    const onAnnounce = () => syncWallet()
    window.addEventListener('eip6963:announceProvider', onAnnounce)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      eth.removeListener?.('accountsChanged', onAccounts)
      eth.removeListener?.('chainChanged',    onChain)
      window.removeEventListener('eip6963:announceProvider', onAnnounce)
    }
  }, [])

  // ── Balance fetch (Arc USDC) ───────────────────────────────────────────────
  const fetchBalance = React.useCallback(async () => {
    if (!address) { setBalance(null); return }
    try {
      const raw = await arcClient.readContract({
        address: ARC_USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      })
      setBalance(formatUnits(raw, 6))
    } catch {
      setBalance(null)
    }
  }, [address])

  React.useEffect(() => {
    fetchBalance()
    const id = setInterval(fetchBalance, 30_000)
    return () => clearInterval(id)
  }, [fetchBalance])

  // ── Actions ────────────────────────────────────────────────────────────────
  const connect = async () => {
    const eth = typeof window !== 'undefined' ? getEvmProvider() : null
    if (!eth) { alert('No EVM wallet detected. Please install MetaMask, OKX Wallet, Rabby, or any EIP-1193 compatible wallet.'); return }
    try {
      await eth.request({ method: 'eth_requestAccounts' })
      const [accs, cid] = await Promise.all([
        eth.request({ method: 'eth_accounts' }),
        eth.request({ method: 'eth_chainId' }),
      ])
      setAddress(accs?.[0] || null)
      setChainId(cid || null)
    } catch { /* user rejected */ }
  }

  const disconnect = () => {
    setAddress(null)
    setChainId(null)
    setBalance(null)
    setShowMenu(false)
  }

  const copyAddress = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const network = chainId ? (NETWORK_LABELS[chainId] ?? { label: `Chain ${parseInt(chainId, 16)}`, dot: '#6b7280', testnet: true }) : null

  // ── Skeleton (SSR) ─────────────────────────────────────────────────────────
  if (!mounted) {
    return <div style={{ width: 120, height: 36, borderRadius: 9999, background: 'rgba(255,255,255,0.05)' }} />
  }

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!address) {
    return (
      <button
        type="button"
        onClick={connect}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px',
          borderRadius: 9999,
          border: '1px solid #00D4AA',
          background: 'transparent',
          color: '#00D4AA',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "'Space Grotesk', sans-serif",
          cursor: 'pointer',
          transition: 'background 150ms ease',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,170,0.10)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Chain icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        Connect Wallet
      </button>
    )
  }

  // ── Connected pill ─────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', fontFamily: "'Space Grotesk', sans-serif" }}>
      {/* Pill button */}
      <button
        type="button"
        onClick={() => setShowMenu(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          borderRadius: 9999,
          border: '1px solid rgba(255,255,255,0.12)',
          background: showMenu ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)',
          color: '#ffffff',
          fontSize: 13,
          cursor: 'pointer',
          transition: 'background 150ms ease',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { if (!showMenu) e.currentTarget.style.background = 'rgba(255,255,255,0.10)' }}
        onMouseLeave={e => { if (!showMenu) e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
      >
        {/* Green dot */}
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: '#22C55E', boxShadow: '0 0 6px #22C55E',
          flexShrink: 0,
        }} />

        {/* Balance — hidden on small screens */}
        {balance !== null && (
          <span className="hidden sm:inline" style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
            {formatBalance(balance)} USDC
          </span>
        )}

        {/* Separator */}
        {balance !== null && (
          <span className="hidden sm:inline" style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>|</span>
        )}

        {/* Address */}
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
          {shortAddr(address)}
        </span>

        {/* Chevron */}
        <span style={{
          color: 'rgba(255,255,255,0.35)',
          fontSize: 10,
          transform: showMenu ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 150ms ease',
        }}>▾</span>
      </button>

      {/* Dropdown */}
      {showMenu && (
        <>
          {/* Backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            onClick={() => setShowMenu(false)}
          />

          {/* Menu */}
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)',
            minWidth: 240,
            background: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 50,
            overflow: 'hidden',
            animation: 'dropdownIn 150ms ease',
          }}>

            {/* Address row */}
            <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>Connected</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
                  {shortAddr(address)}
                </span>
                <button
                  type="button"
                  onClick={copyAddress}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px', borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'transparent',
                    color: copied ? '#22C55E' : 'rgba(255,255,255,0.5)',
                    fontSize: 11, cursor: 'pointer',
                    transition: 'color 150ms ease',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {copied ? '✓ Copied!' : '📋 Copy'}
                </button>
              </div>
            </div>

            {/* Balance row */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 3 }}>USDC Balance</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#ffffff' }}>
                {balance !== null ? `${formatBalance(balance)} USDC` : '—'}
              </div>
            </div>

            {/* Network row */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>Network</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
                  {network && (
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: network.dot, flexShrink: 0,
                    }} />
                  )}
                  {network?.label ?? '—'}
                  {network?.testnet && (
                    <span style={{
                      fontSize: 10, padding: '1px 5px', borderRadius: 4,
                      background: 'rgba(245,158,11,0.15)', color: '#F59E0B',
                    }}>testnet</span>
                  )}
                </span>
                {/* Switch to Arc button — only shown when not already on Arc */}
                {chainId !== ARC_CHAIN_ID_HEX && (
                  <button
                    type="button"
                    onClick={async () => {
                      const eth = getEvmProvider()
                      if (!eth) return
                      try {
                        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] })
                      } catch (e) {
                        if (e?.code === 4902) {
                          await eth.request({
                            method: 'wallet_addEthereumChain',
                            params: [{
                              chainId: ARC_CHAIN_ID_HEX,
                              chainName: 'Arc Testnet',
                              nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
                              rpcUrls: ['https://rpc.testnet.arc.network'],
                              blockExplorerUrls: ['https://testnet.arcscan.app'],
                            }],
                          })
                        }
                      }
                    }}
                    style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 6,
                      border: '1px solid rgba(0,212,170,0.3)',
                      background: 'rgba(0,212,170,0.08)',
                      color: '#00D4AA', cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Switch to Arc ↗
                  </button>
                )}
              </div>
            </div>

            {/* Disconnect */}
            <button
              type="button"
              onClick={disconnect}
              style={{
                width: '100%', textAlign: 'left',
                padding: '10px 14px',
                background: 'transparent',
                border: 'none',
                color: '#f87171',
                fontSize: 13,
                cursor: 'pointer',
                transition: 'background 150ms ease',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(248,113,113,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              🔌 Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  )
}
