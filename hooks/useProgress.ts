/**
 * hooks/useProgress.ts
 * Map BridgeKit events ke UI steps dan log timeline.
 * Adaptasi dari sample resmi Circle:
 * https://github.com/circlefin/circle-bridge-kit-transfer/blob/main/src/hooks/useProgress.ts
 *
 * BridgeKit event format:
 * { method: 'approve'|'burn'|'fetchAttestation'|'mint', values: { state, txHash?, error? } }
 */
'use client'

import { useState, useCallback } from 'react'

export type BridgeStep =
  | 'idle'
  | 'approving'
  | 'burning'
  | 'waiting-attestation'
  | 'minting'
  | 'completed'
  | 'error'

export interface ProgressLog {
  timestamp: Date
  step:      BridgeStep
  message:   string
  txHash?:   string
}

const STEP_LABELS: Record<BridgeStep, string> = {
  'idle':               'Menunggu',
  'approving':          'Menyetujui USDC…',
  'burning':            'Burning USDC di source chain…',
  'waiting-attestation':'Menunggu attestation Circle Iris…',
  'minting':            'Minting USDC di destination chain…',
  'completed':          'Bridge selesai ✅',
  'error':              'Bridge gagal ❌',
}

export function useProgress() {
  const [currentStep, setCurrentStep] = useState<BridgeStep>('idle')
  const [logs,        setLogs]        = useState<ProgressLog[]>([])

  const addLog = useCallback((step: BridgeStep, message: string, txHash?: string) => {
    setLogs(prev => [...prev, { timestamp: new Date(), step, message, txHash }])
  }, [])

  const reset = useCallback(() => {
    setCurrentStep('idle')
    setLogs([])
  }, [])

  /**
   * Handle event dari BridgeKit.
   * Dipanggil via onEvent callback di useBridge.bridge().
   */
  const handleEvent = useCallback((evt: Record<string, unknown>) => {
    const method = evt.method as string
    const values = (evt.values ?? {}) as Record<string, unknown>
    const state  = values.state as string
    const txHash = values.txHash as string | undefined
    const error  = values.error as string | undefined

    // Mapping event → step
    if (method === 'approve') {
      if (state === 'pending') {
        setCurrentStep('approving')
        addLog('approving', 'Menunggu persetujuan USDC di wallet…')
      } else if (state === 'success') {
        addLog('approving', 'USDC disetujui ✅', txHash)
        setCurrentStep('burning')
      } else if (state === 'error') {
        setCurrentStep('error')
        addLog('error', `Approve gagal: ${error ?? 'unknown'}`)
      }
    } else if (method === 'burn') {
      if (state === 'pending') {
        setCurrentStep('burning')
        addLog('burning', 'Mengirim USDC ke bridge (depositForBurn)…')
      } else if (state === 'success') {
        addLog('burning', 'USDC berhasil di-burn ✅', txHash)
        setCurrentStep('waiting-attestation')
      } else if (state === 'error') {
        setCurrentStep('error')
        addLog('error', `Burn gagal: ${error ?? 'unknown'}`)
      }
    } else if (method === 'fetchAttestation') {
      if (state === 'pending') {
        setCurrentStep('waiting-attestation')
        addLog('waiting-attestation', 'Menunggu attestation dari Circle Iris… (1–20 menit)')
      } else if (state === 'success') {
        addLog('waiting-attestation', 'Attestation diterima ✅')
        setCurrentStep('minting')
      } else if (state === 'error') {
        setCurrentStep('error')
        addLog('error', `Attestation gagal: ${error ?? 'unknown'}`)
      }
    } else if (method === 'mint') {
      if (state === 'pending') {
        setCurrentStep('minting')
        addLog('minting', 'Minting USDC di destination chain…')
      } else if (state === 'success') {
        addLog('minting', 'USDC berhasil di-mint ✅', txHash)
        setCurrentStep('completed')
      } else if (state === 'error') {
        setCurrentStep('error')
        addLog('error', `Mint gagal: ${error ?? 'unknown'}`)
      }
    }
  }, [addLog])

  return {
    currentStep,
    setCurrentStep,
    stepLabel: STEP_LABELS[currentStep],
    logs,
    addLog,
    handleEvent,
    reset,
  }
}
