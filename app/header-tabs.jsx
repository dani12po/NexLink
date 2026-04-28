'use client'

import React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

function BridgeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 18h20M2 18v-4a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v4M6 14v4M18 14v4"/>
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/>
    </svg>
  )
}

function FaucetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2v6M8 8h8M7 8c0 0-3 3-3 7a8 8 0 0 0 16 0c0-4-3-7-3-7"/>
    </svg>
  )
}

const ACTIVE = {
  background: 'rgba(0,212,170,0.10)',
  border: '1px solid rgba(0,212,170,0.25)',
  color: '#00D4AA',
  fontWeight: 500,
}

const INACTIVE = {
  background: 'transparent',
  border: '1px solid transparent',
  color: 'rgba(255,255,255,0.45)',
  fontWeight: 400,
}

function Tab({ icon, label, isActive, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 16px',
        borderRadius: 7,
        fontSize: 14,
        cursor: 'pointer',
        transition: 'all 150ms ease',
        fontFamily: "'Space Grotesk', sans-serif",
        ...(isActive ? ACTIVE : INACTIVE),
      }}
      onMouseEnter={e => {
        if (!isActive) {
          e.currentTarget.style.color = 'rgba(255,255,255,0.8)'
          e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          e.currentTarget.style.color = 'rgba(255,255,255,0.45)'
          e.currentTarget.style.background = 'transparent'
        }
      }}
    >
      {icon}
      {label}
    </button>
  )
}

export default function HeaderTabs() {
  const pathname     = usePathname()
  const router       = useRouter()
  const searchParams = useSearchParams()

  // Mount guard — searchParams bisa berbeda antara SSR dan client
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => { setMounted(true) }, [])

  const currentTab = searchParams.get('tab') || 'bridge'
  const isDapp     = pathname === '/dapp'
  const isFaucet   = pathname === '/'

  // Saat SSR/sebelum mount, render tabs tanpa active state
  // untuk menghindari hydration mismatch dari searchParams
  return (
    <>
      <Tab
        icon={<BridgeIcon />}
        label="Bridge"
        isActive={mounted && isDapp && currentTab === 'bridge'}
        onClick={() => router.push('/dapp?tab=bridge')}
      />
      <Tab
        icon={<SwapIcon />}
        label="Swap"
        isActive={mounted && isDapp && currentTab === 'swap'}
        onClick={() => router.push('/dapp?tab=swap')}
      />
      <Tab
        icon={<FaucetIcon />}
        label="Faucet"
        isActive={mounted && isFaucet}
        onClick={() => router.push('/')}
      />
    </>
  )
}
