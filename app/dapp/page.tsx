/**
 * app/dapp/page.tsx
 * Arc Network DApp — Bridge + Swap + Nanopayment x402
 * Tab is controlled by ?tab=bridge|swap in the URL (set by header tabs)
 */
'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import TxHistory from '@/components/TxHistory'

const BridgePanel      = dynamic(() => import('@/components/BridgePanel'),      { ssr: false })
const SwapPanel        = dynamic(() => import('@/components/SwapPanel'),        { ssr: false })
const NanopaymentPanel = dynamic(() => import('@/components/NanopaymentPanel'), { ssr: false })

function DAppContent() {
  const searchParams = useSearchParams()
  const tab = (searchParams.get('tab') || 'bridge') as 'bridge' | 'swap'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* ── LEFT: Bridge or Swap panel (2/3 width) ── */}
      <div className="lg:col-span-2 space-y-6">

        {/* Active panel */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
          {tab === 'bridge' ? (
            <>
              <div className="mb-5">
                <h2 className="text-lg font-semibold">Bridge USDC</h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Transfer USDC antara Ethereum Sepolia ↔ Arc Testnet via Circle CCTP
                </p>
              </div>
              <BridgePanel />
            </>
          ) : (
            <>
              <div className="mb-5">
                <h2 className="text-lg font-semibold">Swap Token</h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Swap USDC ↔ EURC di Arc Testnet via StableFX
                </p>
              </div>
              <SwapPanel />
            </>
          )}
        </div>

        {/* Transaction History */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
          <TxHistory />
        </div>
      </div>

      {/* ── RIGHT: Nanopayment (1/3 width) ── */}
      <div className="space-y-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold">Nanopayment</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Kirim micropayment USDC via x402 HTTP protocol
            </p>
          </div>
          <NanopaymentPanel />
        </div>

        {/* Network info card */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-300">Arc Testnet</h3>
          <div className="space-y-2 text-xs">
            <InfoRow label="Chain ID"  value="5042002" />
            <InfoRow label="Currency"  value="USDC (native)" />
            <InfoRow label="RPC"       value="rpc.testnet.arc.network" />
            <InfoRow label="USDC"      value="0x3600…0000" mono />
            <InfoRow label="EURC"      value="0x89B5…72a"  mono />
          </div>
          <div className="pt-2 space-y-1.5">
            <ExtLink href="https://faucet.circle.com"      label="Get testnet USDC" />
            <ExtLink href="https://testnet.arcscan.app"    label="ArcScan Explorer" />
            <ExtLink href="https://docs.arc.network"       label="Arc Docs" />
          </div>
        </div>
      </div>

    </div>
  )
}

export default function DAppPage() {
  return (
    <React.Suspense fallback={<div className="text-zinc-500 text-sm">Loading…</div>}>
      <DAppContent />
    </React.Suspense>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-zinc-600">{label}</span>
      <span className={`text-zinc-400 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function ExtLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
    >
      <span>{label}</span><span>↗</span>
    </a>
  )
}
