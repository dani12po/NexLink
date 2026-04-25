/**
 * lib/txHistory.ts
 * Transaction history — disimpan per wallet di localStorage.
 * Key prefix v2 untuk clear data lama yang tidak kompatibel.
 */

export type TxType   = 'bridge' | 'swap' | 'send'
export type TxStatus = 'pending' | 'success' | 'failed'

export interface TxRecord {
  id:        string
  type:      TxType
  status:    TxStatus
  timestamp: number

  // Bridge
  direction?:  'sepolia-to-arc' | 'arc-to-sepolia'
  fromChain?:  string
  toChain?:    string
  burnTx?:     string
  mintTx?:     string
  amountSent?: string

  // Swap
  fromToken?:  string
  toToken?:    string
  fromAmount?: string
  toAmount?:   string

  // Common
  txHash?:      string
  explorerUrl?: string
  wallet?:      string
  errorMsg?:    string
}

// ─── Key v2 — otomatis invalidate data lama ───────────────────────────────────
const V2_KEY_PREFIX = 'arcdapp_v2_tx_'
const MAX_STORED    = 100
export const PAGE_SIZE = 10

function storageKey(address: string) {
  return `${V2_KEY_PREFIX}${address.toLowerCase()}`
}

function clearLegacyData(address: string) {
  if (typeof window === 'undefined') return
  const oldKey = `nexlink_tx_${address.toLowerCase()}`
  if (localStorage.getItem(oldKey) !== null) localStorage.removeItem(oldKey)
}

export function loadHistory(address?: string | null): TxRecord[] {
  if (typeof window === 'undefined' || !address) return []
  clearLegacyData(address)
  try {
    return JSON.parse(localStorage.getItem(storageKey(address)) ?? '[]')
  } catch {
    return []
  }
}

export function saveHistory(address: string, records: TxRecord[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(storageKey(address), JSON.stringify(records.slice(0, MAX_STORED)))
}

export function addTx(record: Omit<TxRecord, 'id' | 'timestamp'>): TxRecord {
  const tx: TxRecord = {
    ...record,
    id:        `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

export function clearAllHistory(wallet: string): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(storageKey(wallet))
}

export function getTotalPages(records: TxRecord[]): number {
  return Math.max(1, Math.ceil(records.length / PAGE_SIZE))
}

export function getPage(records: TxRecord[], page: number): TxRecord[] {
  const start = (page - 1) * PAGE_SIZE
  return records.slice(start, start + PAGE_SIZE)
}
