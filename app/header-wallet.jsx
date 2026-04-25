'use client'

import React from 'react'
import { createPublicClient, http, formatUnits, erc20Abi } from 'viem'
import { getEvmProvider } from '@/lib/evmProvider'
import { ARC_CHAIN_ID, ARC_CHAIN_ID_HEX, ARC_RPC, ARC_USDC, arcTestnet } from '@/lib/arcChain'
import { useWallet } from '@/components/WalletButton'

// ── Constants ────────────────────────────────────────────────────────────────
const NETWORK_LABELS = {
  '0x1':       { label: 'Mainnet',      dot: '#22C55E', testnet: false },
  '0xaa36a7':  { label: 'Sepolia',      dot: '#F59E0B', testnet: true  },
  '0x4cef52':  { label: 'Arc Testnet',  dot: '#F59E0B', testnet: true  },
  '0x2105':    { label: 'Base',         dot: '#22C55E', testnet: false },
}

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ''
}

function formatBalance(raw) {
  if (raw === null) return '—'
  const n = parseFloat(raw)
  if (isNaN(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

// ── Main component ───────────────────────────────────────────────────────────
export default function HeaderWallet() {
  // ── Pakai shared WalletButton state ────────────────────────────────────────
  const { address, chainId: chainIdNum, connected, connect, disconnect } = useWallet()
  // WalletButton.chainId adalah number, NETWORK_LABELS butuh hex string
  const chainId = chainIdNum != null ? `0x${chainIdNum.toString(16)}` : null

  const [mounted,  setMounted]  = React.useState(false)
  const [balance,  setBalance]  = React.useState(null)
  const [showMenu, setShowMenu] = React.useState(false)
  const [copied,   setCopied]   = React.useState(false)

  React.useEffect(() => { setMounted(true) }, [])

  // ── Balance fetch (Arc USDC) ───────────────────────────────────────────────
  const arcClient = React.useMemo(() => createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_RPC),
  }), [])

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
  }, [address, arcClient])

  React.useEffect(() => {
    if (!connected) { setBalance(null); return }
    fetchBalance()
    const id = setInterval(fetchBalance, 30_000)
    return () => clearInterval(id)
  }, [fetchBalance, connected])

  // ── Actions ────────────────────────────────────────────────────────────────
  const copyAddress = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const network = chainId
    ? (NETWORK_LABELS[chainId] ?? { label: `Chain ${parseInt(chainId, 16)}`, dot: '#6b7280', testnet: true })
    : null

  // ── Skeleton (SSR) ─────────────────────────────────────────────────────────
  if (!mounted) {
    return <div style={{ width: 120, height: 36, borderRadius: 9999, background: 'rgba(255,255,255,0.05)' }} />
  }

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!connected) {
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
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E', flexShrink: 0 }} />
        {balance !== null && (
          <span className="hidden sm:inline" style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
            {formatBalance(balance)} USDC
          </span>
        )}
        {balance !== null && (
          <span className="hidden sm:inline" style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>|</span>
        )}
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
          {shortAddr(address)}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, transform: showMenu ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }}>▾</span>
      </button>

      {/* Dropdown */}
      {showMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowMenu(false)} />
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)',
            minWidth: 240, background: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 50, overflow: 'hidden',
          }}>
            {/* Address row */}
            <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>Connected</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>{shortAddr(address)}</span>
                <button type="button" onClick={copyAddress} style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
                  color: copied ? '#22C55E' : 'rgba(255,255,255,0.5)', fontSize: 11, cursor: 'pointer',
                  transition: 'color 150ms ease', whiteSpace: 'nowrap',
                }}>
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
                  {network && <span style={{ width: 7, height: 7, borderRadius: '50%', background: network.dot, flexShrink: 0 }} />}
                  {network?.label ?? '—'}
                  {network?.testnet && (
                    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}>testnet</span>
                  )}
                </span>
                {chainId !== ARC_CHAIN_ID_HEX && (
                  <button type="button" onClick={async () => {
                    const eth = getEvmProvider()
                    if (!eth) return
                    try {
                      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] })
                    } catch (e) {
                      if (e?.code === 4902) {
                        await eth.request({ method: 'wallet_addEthereumChain', params: [{
                          chainId: ARC_CHAIN_ID_HEX, chainName: 'Arc Testnet',
                          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
                          rpcUrls: ['https://rpc.testnet.arc.network'],
                          blockExplorerUrls: ['https://testnet.arcscan.app'],
                        }]})
                      }
                    }
                  }} style={{
                    fontSize: 11, padding: '3px 8px', borderRadius: 6,
                    border: '1px solid rgba(0,212,170,0.3)', background: 'rgba(0,212,170,0.08)',
                    color: '#00D4AA', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                    Switch to Arc ↗
                  </button>
                )}
              </div>
            </div>

            {/* Disconnect */}
            <button type="button" onClick={() => { disconnect(); setShowMenu(false) }} style={{
              width: '100%', textAlign: 'left', padding: '10px 14px',
              background: 'transparent', border: 'none', color: '#f87171',
              fontSize: 13, cursor: 'pointer', transition: 'background 150ms ease',
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
