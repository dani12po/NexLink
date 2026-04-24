/**
 * hooks/useBridge.ts
 * Bridge state machine — CCTP V2 manual via server mint
 * FIX: mintWithFallback sekarang return MintResult (bukan void/stale closure)
 */
'use client'

import { useState, useCallback } from 'react'

export type BridgeDirection = 'sepolia-to-arc' | 'arc-to-sepolia'

export type BridgeStatus =
  | 'idle'
  | 'approving'
  | 'burning'
  | 'polling'
  | 'minting'
  | 'success'
  | 'error'

export interface BridgeState {
  status: BridgeStatus
  txHash: string | null
  mintTxHash: string | null
  explorerUrl: string | null
  error: string | null
  method: 'manual' | null
  progress: number
}

export interface MintResult {
  ok: boolean
  mintTxHash?: string | null
  explorerUrl?: string | null
  alreadyMinted?: boolean
  error?: string
}

const INITIAL_STATE: BridgeState = {
  status: 'idle',
  txHash: null,
  mintTxHash: null,
  explorerUrl: null,
  error: null,
  method: null,
  progress: 0,
}

export const STATUS_MESSAGES: Record<BridgeStatus, string> = {
  idle:      '',
  approving: '⏳ Menyetujui USDC...',
  burning:   '🔥 Burning USDC di source chain...',
  polling:   '⌛ Menunggu attestation Circle (~2–15 menit)...',
  minting:   '🪙 Minting USDC di destination chain...',
  success:   '✅ Bridge berhasil!',
  error:     '❌ Bridge gagal',
}

export function useBridge() {
  const [state, setState] = useState<BridgeState>(INITIAL_STATE)

  function update(partial: Partial<BridgeState>) {
    setState(prev => ({ ...prev, ...partial }))
  }

  async function tryManualMint(params: {
    direction: BridgeDirection
    msgBytes: string
    att: string
  }): Promise<MintResult> {
    try {
      const res = await fetch('/api/bridge/mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          msgBytes: params.msgBytes,
          att: params.att,
          direction: params.direction,
        }),
      })
      const data = await res.json()
      if (!data.ok) return { ok: false, error: data.error || 'Mint failed' }
      if (data.alreadyMinted) {
        return { ok: true, alreadyMinted: true, mintTxHash: null, explorerUrl: null }
      }
      return { ok: true, mintTxHash: data.txHash, explorerUrl: data.explorerUrl }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  // ── FIX BUG #1: Return MintResult — caller tidak perlu baca bridgeState (stale closure) ──
  const mintWithFallback = useCallback(async (params: {
    amount: string
    direction: BridgeDirection
    recipient?: string
    msgBytes: string
    att: string
  }): Promise<MintResult> => {
    update({ status: 'minting', progress: 75, method: 'manual' })

    const manualResult = await tryManualMint({
      direction: params.direction,
      msgBytes: params.msgBytes,
      att: params.att,
    })

    if (manualResult.ok) {
      const alreadyMintedMsg = manualResult.alreadyMinted
        ? 'USDC sudah berhasil di-mint sebelumnya di destination chain ✅'
        : undefined
      update({
        status: 'success',
        mintTxHash: manualResult.mintTxHash || null,
        explorerUrl: manualResult.explorerUrl || null,
        method: 'manual',
        progress: 100,
      })
      if (alreadyMintedMsg) console.info('[useBridge]', alreadyMintedMsg)
      return {
        ok: true,
        mintTxHash: manualResult.mintTxHash,
        explorerUrl: manualResult.explorerUrl,
        alreadyMinted: manualResult.alreadyMinted,
      }
    } else {
      update({
        status: 'error',
        error: `Mint gagal: ${manualResult.error}. Coba ulangi atau hubungi support.`,
        progress: 0,
      })
      return { ok: false, error: manualResult.error }
    }
  }, [])

  function reset() { setState(INITIAL_STATE) }

  return { state, update, mintWithFallback, reset }
}
