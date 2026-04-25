/**
 * hooks/useBridge.ts
 * Bridge USDC via @circle-fin/bridge-kit.
 * Ref: https://github.com/circlefin/circle-bridge-kit-transfer/blob/master/src/hooks/useBridge.ts
 */
'use client'
import { useState, useCallback, useRef } from 'react'
import { getBridgeKit } from '@/lib/bridgeKitSingleton'
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
      const kit = getBridgeKit()

      const bridgeResult = await kit.bridge({
        from:   { adapter, chain: fromChain },
        to:     { adapter, chain: toChain },
        amount,
        config: { transferSpeed: 'FAST' },
        onStep: (step: any) => {
          const name   = step?.name   as BridgeStepName  | undefined
          const state  = step?.state  as BridgeStepState | undefined
          const txHash = step?.txHash ?? step?.data?.txHash as string | undefined
          const error  = step?.error  ?? step?.errorMessage as string | undefined
          if (name && state) onStep({ name, state, txHash, error })
        },
      } as any)

      lastResultRef.current = bridgeResult

      const steps    = (bridgeResult as any)?.steps ?? []
      const mintStep = steps.find((s: any) => s.name === 'mint')
      const mintTx   = mintStep?.txHash

      const toChainId = toChain === CHAIN_ARC ? ARC_CHAIN_ID : SEPOLIA_CHAIN_ID
      const expUrl    = mintTx ? getExplorerTxUrl(toChainId, mintTx) : undefined

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
      const kit = getBridgeKit()
      const retryResult = await (kit as any).retry(lastResultRef.current, {
        from: { adapter },
        to:   { adapter },
      })
      lastResultRef.current = retryResult

      const steps  = (retryResult as any)?.steps ?? []
      const mintTx = steps.find((s: any) => s.name === 'mint')?.txHash
      if (mintTx) onStep({ name: 'mint', state: 'success', txHash: mintTx })

      const toChainId = toChain === CHAIN_ARC ? ARC_CHAIN_ID : SEPOLIA_CHAIN_ID
      const expUrl    = mintTx ? getExplorerTxUrl(toChainId, mintTx) : undefined
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
