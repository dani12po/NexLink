/**
 * hooks/useProgress.ts
 * Kelola progress state untuk Bridge UI.
 */
'use client'
import { useState, useCallback } from 'react'
import type { BridgeStepEvent } from './useBridge'

export type ProgressStep = 'idle' | 'approving' | 'burning' | 'attesting' | 'minting' | 'done' | 'error'

export interface ProgressLog {
  step:    string
  state:   string
  txHash?: string
  time:    number
}

export function useProgress() {
  const [step,   setStep]   = useState<ProgressStep>('idle')
  const [logs,   setLogs]   = useState<ProgressLog[]>([])
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const handleStepEvent = useCallback((evt: BridgeStepEvent) => {
    if (evt.state === 'pending') {
      const map: Record<string, ProgressStep> = {
        approve:          'approving',
        burn:             'burning',
        fetchAttestation: 'attesting',
        mint:             'minting',
      }
      setStep(map[evt.name] ?? 'idle')
    }
    if (evt.state === 'success' && evt.name === 'mint') setStep('done')
    if (evt.state === 'error') { setStep('error'); setErrMsg(evt.error ?? null) }

    setLogs(prev => [...prev, { step: evt.name, state: evt.state, txHash: evt.txHash, time: Date.now() }])
  }, [])

  function reset() {
    setStep('idle'); setLogs([]); setErrMsg(null)
  }

  const STEP_LABELS: Record<ProgressStep, string> = {
    idle:      'Menunggu',
    approving: 'Approve USDC…',
    burning:   'Burn di source chain…',
    attesting: 'Menunggu attestation Circle…',
    minting:   'Mint di destination chain…',
    done:      'Bridge selesai!',
    error:     'Terjadi kesalahan',
  }

  return { step, stepLabel: STEP_LABELS[step], logs, errMsg, handleStepEvent, reset }
}
