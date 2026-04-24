/**
 * lib/txHistory.ts
 * Transaction history utils — disimpan per wallet di localStorage.
 */

export type TxType   = 'bridge' | 'swap'
export type TxStatus = 'pending' | 'success' | 'failed' | 'attestation'

export interface TxRecord {
  id:        string
  type:      TxType
  status:    TxStatus
  timestamp: number

  // Bridge fields
  direction?:      'sepolia-to-arc' | 'arc-to-sepolia'
  fromChain?:      string
  toChain?:        string
  amountSent?:     string
  amountReceived?: string
  fee?:            string
  burnTx?:         string
  mintTx?:         string

  // Swap fields
  fromToken?:  string
  toToken?:    string
  fromAmount?: string
  toAmount?:   string
  txHash?:     string

  // Common
  wallet?:   string
  errorMsg?: string
}

const MAX_RECORDS = 50

function walletKey(address: string): string {
  return `nexlink_tx_${address.toLowerCase()}`
}

export function loadHistory(address?: string | null): TxRecord[] {
  if (typeof window === 'undefined' || !address) return []
  try {
    return JSON.parse(localStorage.getItem(walletKey(address)) ?? '[]')
  } catch {
    return []
  }
}

export function saveHistory(address: string, records: TxRecord[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(walletKey(address), JSON.stringify(records.slice(0, MAX_RECORDS)))
}

export function addTx(record: Omit<TxRecord, 'id' | 'timestamp'>): TxRecord {
  const tx: TxRecord = {
    ...record,
    id:        `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
  }
  if (!record.wallet) return tx
  const history = loadHistory(record.wallet)
  saveHistory(record.wallet, [tx, ...history])
  return tx
}

export function updateTx(id: string, patch: Partial<TxRecord>, wallet?: string): void {
  if (!wallet) return
  const history = loadHistory(wallet)
  const idx = history.findIndex(t => t.id === id)
  if (idx === -1) return
  history[idx] = { ...history[idx], ...patch }
  saveHistory(wallet, history)
}

/**
 * Estimasi USDC yang diterima setelah CCTP fee.
 * CCTP_MAX_FEE = 0.001 USDC — amount harus > fee ini.
 */
export function estimateBridgeReceived(amountStr: string): { received: string; fee: string } {
  const amount  = parseFloat(amountStr) || 0
  const fee     = 0.001
  const received = Math.max(0, amount - fee)
  return {
    received: received.toFixed(6),
    fee:      fee.toFixed(6),
  }
}
