/**
 * hooks/useBridge.ts
 * Bridge USDC via @circle-fin/app-kit (AppKit).
 * Ref: https://docs.arc.network/app-kit/quickstarts/bridge-tokens-across-blockchains#viem
 *
 * Flow: Approve → Burn → Attestation (Iris API) → Mint
 * Adapter: createViemAdapterFromProvider (dari @circle-fin/adapter-viem-v2)
 */
'use client'
import { useState, useCallback, useRef } from 'react'
import { getAppKit } from '@/lib/bridgeKitSingleton'
import { CHAIN_ARC, ARC_CHAIN_ID, SEPOLIA_CHAIN_ID, getExplorerTxUrl } from '@/lib/arcChain'

export type BridgeStepName  = 'approve' | 'burn' | 'fetchAttestation' | 'mint'
export type BridgeStepState = 'pending' | 'success' | 'error'

export interface BridgeStepEvent {
  name:    BridgeStepName
  state:   BridgeStepState
  txHash?: string
  error?:  string
}

export interface BridgeParams {
  fromChain: string
  toChain:   string
  amount:    string
  adapter:   any
  onStep:    (event: BridgeStepEvent) => void
}

export interface BridgeResult {
  ok:           boolean
  mintTxHash?:  string
  explorerUrl?: string
}

/**
 * Ekstrak txHash dari step result — AppKit menyimpan di step.txHash atau step.data.txHash
 */
function extractTxHash(step: any): string | undefined {
  return step?.txHash ?? step?.data?.txHash ?? undefined
}

/**
 * Ekstrak explorerUrl dari step result
 */
function extractExplorerUrl(step: any): string | undefined {
  return step?.data?.explorerUrl ?? step?.explorerUrl ?? undefined
}

export function useBridge() {
  const [isLoading, setIsLoading] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [result,    setResult]    = useState<BridgeResult | null>(null)
  const lastResultRef = useRef<any>(null)

  const bridge = useCallback(async (params: BridgeParams): Promise<BridgeResult> => {
    const { fromChain, toChain, amount, adapter, onStep } = params
    if (!adapter) throw new Error('Wallet adapter belum siap')

    setIsLoading(true); setError(null); setResult(null)

    try {
      const kit = getAppKit()

      // Sesuai docs Arc: kit.bridge({ from, to, amount })
      // Adapter yang sama dipakai untuk source dan destination (EVM-to-EVM)
      const bridgeResult = await kit.bridge({
        from: { adapter, chain: fromChain as any },
        to:   { adapter, chain: toChain   as any },
        amount,
        // onStep callback — AppKit emit step events selama proses bridge
        onStep: (step: any) => {
          // Normalize step event ke format internal
          const name   = (step?.name   ?? '') as BridgeStepName
          const state  = (step?.state  ?? 'pending') as BridgeStepState
          const txHash = extractTxHash(step)
          const errMsg = step?.error ?? step?.errorMessage ?? undefined

          if (name) onStep({ name, state, txHash, error: errMsg })
        },
      } as any)

      lastResultRef.current = bridgeResult

      // Ambil mint txHash dari steps array
      const steps    = (bridgeResult as any)?.steps ?? []
      const mintStep = steps.find((s: any) => s.name === 'mint')
      const mintTx   = extractTxHash(mintStep)
      const mintUrl  = extractExplorerUrl(mintStep)

      // Fallback: generate explorer URL dari chain
      const toChainId = toChain === CHAIN_ARC ? ARC_CHAIN_ID : SEPOLIA_CHAIN_ID
      const expUrl    = mintUrl ?? (mintTx ? getExplorerTxUrl(toChainId, mintTx) : undefined)

      const res: BridgeResult = { ok: true, mintTxHash: mintTx, explorerUrl: expUrl }
      setResult(res)
      return res

    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Bridge gagal'
      setError(msg)
      throw e
    } finally {
      setIsLoading(false)
    }
  }, [])

  const retry = useCallback(async (
    adapter: any,
    toChain: string,
    onStep:  BridgeParams['onStep'],
  ): Promise<BridgeResult> => {
    if (!lastResultRef.current) throw new Error('Tidak ada bridge yang bisa di-retry')
    setIsLoading(true); setError(null)
    try {
      const kit = getAppKit()

      // AppKit retry — lanjutkan dari step yang gagal
      const retryResult = await (kit as any).retry(lastResultRef.current, {
        from: { adapter },
        to:   { adapter },
      })
      lastResultRef.current = retryResult

      const steps  = (retryResult as any)?.steps ?? []
      const mintStep = steps.find((s: any) => s.name === 'mint')
      const mintTx = extractTxHash(mintStep)
      const mintUrl = extractExplorerUrl(mintStep)

      if (mintTx) onStep({ name: 'mint', state: 'success', txHash: mintTx })

      const toChainId = toChain === CHAIN_ARC ? ARC_CHAIN_ID : SEPOLIA_CHAIN_ID
      const expUrl    = mintUrl ?? (mintTx ? getExplorerTxUrl(toChainId, mintTx) : undefined)
      const res: BridgeResult = { ok: true, mintTxHash: mintTx, explorerUrl: expUrl }
      setResult(res)
      return res
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Retry gagal'
      setError(msg)
      throw e
    } finally {
      setIsLoading(false)
    }
  }, [])

  function reset() {
    setError(null); setResult(null); setIsLoading(false)
    lastResultRef.current = null
  }

  return { bridge, retry, isLoading, error, result, reset }
}
