/**
 * hooks/useBridge.ts
 * Wrapper tipis di atas @circle-fin/bridge-kit.
 *
 * BridgeKit mengelola seluruh flow CCTP V2 secara internal:
 * - Approve USDC
 * - DepositForBurn
 * - Poll Circle Iris DARI BROWSER (tidak kena IP block Vercel)
 * - ReceiveMessage (mint) di destination
 *
 * Ref: https://docs.arc.network/app-kit/bridge
 * Sample: https://github.com/circlefin/circle-bridge-kit-transfer
 */
'use client'

import { useState } from 'react'
import { BridgeKit } from '@circle-fin/bridge-kit'
import type { ViemAdapter } from '@circle-fin/adapter-viem-v2'

export type BridgeDirection = 'sepolia-to-arc' | 'arc-to-sepolia'

export interface BridgeParams {
  fromChain:         string       // 'Arc_Testnet' atau 'Ethereum_Sepolia'
  toChain:           string       // 'Arc_Testnet' atau 'Ethereum_Sepolia'
  amount:            string       // '1.5' dalam USDC
  fromAdapter:       ViemAdapter
  toAdapter:         ViemAdapter  // sama dengan fromAdapter untuk EVM-only
  recipientAddress?: string       // opsional, default = wallet address
}

export function useBridge() {
  const [isLoading, setIsLoading] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [result,    setResult]    = useState<any>(null)

  /**
   * Jalankan bridge via BridgeKit.
   * BridgeKit emit events ke onEvent callback untuk update UI.
   */
  async function bridge(
    params:   BridgeParams,
    options?: { onEvent?: (evt: Record<string, unknown>) => void },
  ) {
    setIsLoading(true)
    setError(null)
    setResult(null)

    try {
      const kit     = new BridgeKit()
      // Handler pakai 'as any' karena AllActions<TExtraProviders> tidak bisa
      // di-infer dari luar — tipe internal BridgeKit tidak di-export
      const handler = (payload: any) => options?.onEvent?.(payload as Record<string, unknown>)
      kit.on('*', handler)

      try {
        const bridgeResult = await kit.bridge({
          from: {
            adapter: params.fromAdapter,
            chain:   params.fromChain as any,
          },
          to: params.recipientAddress
            ? {
                adapter:          params.toAdapter,
                chain:            params.toChain as any,
                recipientAddress: params.recipientAddress,
              }
            : {
                adapter: params.toAdapter,
                chain:   params.toChain as any,
              },
          amount: params.amount,
        })

        setResult(bridgeResult)
        return { ok: true, data: bridgeResult }
      } finally {
        kit.off('*', handler)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Bridge gagal'
      setError(msg)
      throw e
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Retry bridge yang gagal di tengah jalan.
   * BridgeKit menyimpan state di BridgeResult sehingga bisa dilanjutkan.
   */
  async function retry(
    failedResult: any,
    params:       Pick<BridgeParams, 'fromAdapter' | 'toAdapter'>,
    options?:     { onEvent?: (evt: Record<string, unknown>) => void },
  ) {
    setIsLoading(true)
    setError(null)

    try {
      const kit     = new BridgeKit()
      // Handler pakai 'as any' — AllActions type tidak di-export dari BridgeKit
      const handler = (payload: any) => options?.onEvent?.(payload as Record<string, unknown>)
      kit.on('*', handler)

      try {
        const r = await kit.retry(failedResult, {
          from: params.fromAdapter,
          to:   params.toAdapter,
        })
        setResult(r)
        return { ok: true, data: r }
      } finally {
        kit.off('*', handler)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Retry gagal'
      setError(msg)
      throw e
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Estimasi fee bridge sebelum eksekusi.
   * Return { fee, estimatedTime, ... }
   */
  async function estimate(params: BridgeParams) {
    const kit = new BridgeKit()
    return kit.estimate({
      from: {
        adapter: params.fromAdapter,
        chain:   params.fromChain as any,
      },
      to: params.recipientAddress
        ? {
            adapter:          params.toAdapter,
            chain:            params.toChain as any,
            recipientAddress: params.recipientAddress,
          }
        : {
            adapter: params.toAdapter,
            chain:   params.toChain as any,
          },
      amount: params.amount,
    })
  }

  function clear() {
    setError(null)
    setResult(null)
    setIsLoading(false)
  }

  return { bridge, retry, estimate, isLoading, error, result, clear }
}
