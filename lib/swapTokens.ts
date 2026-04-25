/**
 * lib/swapTokens.ts
 * Token constants dan swap utilities untuk Arc Testnet.
 * Ref: https://docs.arc.network/arc/references/contract-addresses
 *
 * CATATAN: kit.swap() TIDAK tersedia di Arc Testnet.
 * Swap via FxEscrow transfer langsung ke 0x867650...
 */
import { ARC_USDC, ARC_EURC } from './arcChain'

export type TokenSymbol = 'USDC' | 'EURC'

export interface TokenInfo {
  symbol:   TokenSymbol
  name:     string
  address:  `0x${string}`
  decimals: number
  emoji:    string
}

export const SWAP_TOKENS: TokenInfo[] = [
  { symbol: 'USDC', name: 'USD Coin',  address: ARC_USDC, decimals: 6, emoji: '$' },
  { symbol: 'EURC', name: 'Euro Coin', address: ARC_EURC, decimals: 6, emoji: '€' },
]

// Fallback rate jika API tidak tersedia
export const FALLBACK_RATES: Record<string, number> = {
  'USDC-EURC': 0.92,
  'EURC-USDC': 1.087,
}

// Cache rate 30 detik
const rateCache: Record<string, { rate: number; ts: number }> = {}
const CACHE_TTL = 30_000

export async function fetchLiveRate(from: TokenSymbol, to: TokenSymbol): Promise<number> {
  const key = `${from}-${to}`
  const cached = rateCache[key]
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.rate

  // StableFX API tidak tersedia di testnet — pakai fallback rate
  // TODO: ganti dengan endpoint yang benar saat mainnet
  return FALLBACK_RATES[key] ?? 1
}

export interface SwapQuote {
  toAmount:    string
  minReceived: string
  rate:        number
  isLive:      boolean
}

export function calculateQuote(fromAmount: string, rate: number, slippage: string): SwapQuote {
  const from = parseFloat(fromAmount) || 0
  const to   = from * rate
  const slip = parseFloat(slippage) / 100
  return {
    toAmount:    to.toFixed(6),
    minReceived: (to * (1 - slip)).toFixed(6),
    rate,
    isLive:      false,
  }
}

export function getSlippageWarning(slippage: number): boolean {
  return slippage > 5.0
}
