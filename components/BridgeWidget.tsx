'use client'
/**
 * components/BridgeWidget.tsx
 * Wrapper @circle-fin/bridge-kit untuk CCTP V2 bridge.
 * Source: Sepolia ↔ Destination: Arc Testnet
 * Ref: https://docs.arc.network/app-kit/bridge
 */
import React from 'react'
import { getBridgeKit } from '@/lib/bridgeKitSingleton'
import {
  CHAIN_ARC,
  CHAIN_SEPOLIA,
  ARC_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
} from '@/lib/arcChain'

interface BridgeWidgetProps {
  /** Default source chain — 'Ethereum_Sepolia' atau 'Arc_Testnet' */
  defaultFrom?: string
  /** Default destination chain */
  defaultTo?: string
  /** Callback saat bridge selesai */
  onSuccess?: (mintTxHash: string) => void
  /** Callback saat error */
  onError?: (err: Error) => void
}

/**
 * BridgeWidget — render BridgeKit UI dari @circle-fin/bridge-kit.
 *
 * BridgeKit mengelola seluruh flow CCTP V2:
 * Approve → Burn → Attestation (Iris API) → Mint
 *
 * Jika NEXT_PUBLIC_KIT_KEY tidak di-set, widget akan berjalan
 * dalam mode sandbox dengan rate limit ketat.
 */
export function BridgeWidget({
  defaultFrom = CHAIN_SEPOLIA,
  defaultTo   = CHAIN_ARC,
  onSuccess,
  onError,
}: BridgeWidgetProps) {
  const kitKey = process.env.NEXT_PUBLIC_KIT_KEY ?? ''
  const env    = (process.env.NEXT_PUBLIC_BRIDGE_KIT_ENV as 'sandbox' | 'production') ?? 'sandbox'

  // Lazy-load BridgeKit component
  const [BridgeKitComponent, setBridgeKitComponent] = React.useState<React.ComponentType<any> | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    import('@circle-fin/bridge-kit')
      .then((mod) => {
        const Comp = mod.BridgeKit ?? mod.default
        if (Comp) setBridgeKitComponent(Comp as unknown as React.ComponentType<any>)
        else setLoadError('BridgeKit component tidak ditemukan di package')
      })
      .catch((e) => {
        console.error('[BridgeWidget] Failed to load bridge-kit:', e)
        setLoadError(e?.message ?? 'Gagal memuat BridgeKit')
      })
  }, [])

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-900/50 bg-red-500/5 p-4 text-xs text-red-400">
        <p className="font-semibold mb-1">BridgeKit gagal dimuat</p>
        <p className="text-red-500/70">{loadError}</p>
        <p className="mt-2 text-zinc-500">
          Pastikan <code>@circle-fin/bridge-kit</code> terinstall dan{' '}
          <code>NEXT_PUBLIC_KIT_KEY</code> di-set di .env.local
        </p>
      </div>
    )
  }

  if (!BridgeKitComponent) {
    return (
      <div className="flex items-center justify-center py-12 text-xs text-zinc-600">
        <span className="animate-pulse">Memuat BridgeKit…</span>
      </div>
    )
  }

  return (
    <BridgeKitComponent
      kitKey={kitKey}
      env={env}
      // Chain config — sesuai docs Arc Network
      sourceChain={defaultFrom}
      destinationChain={defaultTo}
      // Callback events
      onSuccess={(result: any) => {
        const hash = result?.mintTxHash ?? result?.txHash ?? ''
        onSuccess?.(hash)
      }}
      onError={(err: any) => {
        onError?.(err instanceof Error ? err : new Error(String(err)))
      }}
    />
  )
}

export default BridgeWidget
