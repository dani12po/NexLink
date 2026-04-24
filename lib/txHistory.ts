/**
 * lib/txHistory.ts
 * Client-side transaction history — stored per wallet address in localStorage
 */

export type TxType = 'bridge' | 'swap'
export type TxStatus = 'pending' | 'success' | 'failed' | 'attestation'

export interface TxRecord {
  id: string
  type: TxType
  status: TxStatus
  timestamp: number

  // Bridge fields
  direction?: 'sepolia-to-arc' | 'arc-to-sepolia'
  fromChain?: string
  toChain?: string
  amountSent?: string
  amountReceived?: string
  fee?: string
  burnTx?: string
  mintTx?: string

  // Swap fields
  fromToken?: string
  toToken?: string
  fromAmount?: string
  toAmount?: string
  txHash?: string

  // Common
  wallet?: string
  errorMsg?: string
}

const MAX = 50

/** Storage key scoped to a specific wallet address */
function walletKey(address: string): string {
  return `nexlink_tx_${address.toLowerCase()}`
}

/** Load history for a specific wallet */
export function loadHistory(address?: string | null): TxRecord[] {
  if (typeof window === 'undefined') return []
  if (!address) return []
  try {
    return JSON.parse(localStorage.getItem(walletKey(address)) ?? '[]')
  } catch {
    return []
  }
}

/** Save history for a specific wallet */
export function saveHistory(address: string, records: TxRecord[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(walletKey(address), JSON.stringify(records.slice(0, MAX)))
}

/** Add a new tx record for a wallet */
export function addTx(record: Omit<TxRecord, 'id' | 'timestamp'>): TxRecord {
  const tx: TxRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
  }
  const wallet = record.wallet
  if (!wallet) return tx
  const history = loadHistory(wallet)
  saveHistory(wallet, [tx, ...history])
  return tx
}

/** Update an existing tx record */
export function updateTx(id: string, patch: Partial<TxRecord>, wallet?: string): void {
  if (!wallet) return
  const history = loadHistory(wallet)
  const idx = history.findIndex(t => t.id === id)
  if (idx === -1) return
  history[idx] = { ...history[idx], ...patch }
  saveHistory(wallet, history)
}

/** Estimate received amount after CCTP forwarding fee
 * maxFee = 0.001 USDC (CCTP_MAX_FEE = 1_000 units)
 * amount harus > maxFee agar depositForBurn tidak revert
 */
export function estimateBridgeReceived(amountStr: string): { received: string; fee: string } {
  const amount = parseFloat(amountStr) || 0
  const feeFlat = 0.001  // sesuai CCTP_MAX_FEE = 1_000n
  const received = Math.max(0, amount - feeFlat)
  return {
    received: received.toFixed(6),
    fee: feeFlat.toFixed(6),
  }
}
