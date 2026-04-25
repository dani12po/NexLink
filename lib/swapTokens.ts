/**
 * lib/swapTokens.ts
 * Token constants dan utilities untuk Swap di Arc Testnet.
 *
 * Ref: https://docs.arc.network/arc/references/contract-addresses
 * Ref: https://developers.circle.com/stablefx
 *
 * CATATAN: Circle App Kit swap() TIDAK tersedia di testnet.
 * Swap di Arc Testnet menggunakan StableFX FxEscrow contract langsung.
 * Ref: https://arc-docs.mintlify.app/app-kit/swap
 *   "Swap is not available on Arc Testnet. Use mainnet for Swap."
 */

import { ARC_USDC, ARC_EURC, ARC_USYC } from './arcChain'

// ─── Types ────────────────────────────────────────────────────────────────
export type TokenSymbol = 'USDC' | 'EURC' | 'USYC'

export interface TokenInfo {
  symbol:   TokenSymbol
  name:     string
  address:  `0x${string}`
  decimals: number
  logoChar: string
}

// ─── Token List ───────────────────────────────────────────────────────────
// Sumber: https://docs.arc.network/arc/references/contract-addresses
export const SUPPORTED_TOKENS: TokenInfo[] = [
  { symbol: 'USDC', name: 'USD Coin',      address: ARC_USDC, decimals: 6, logoChar: '$' },
  { symbol: 'EURC', name: 'Euro Coin',     address: ARC_EURC, decimals: 6, logoChar: '€' },
  { symbol: 'USYC', name: 'US Yield Coin', address: ARC_USYC, decimals: 6, logoChar: '⚡' },
]

// Token yang didukung App Kit swap (hanya USDC↔EURC di Arc Testnet via StableFX)
// USYC tidak didukung StableFX RFQ
export const SWAP_TOKENS: TokenInfo[] = SUPPORTED_TOKENS.filter(
  t => t.symbol === 'USDC' || t.symbol === 'EURC',
)

// ─── StableFX Rate Fallback ───────────────────────────────────────────────
// Dipakai jika Circle API tidak tersedia (offline/rate limit)
// Rate aktual diambil dari kit.estimateSwapRate() atau StableFX API
export const FALLBACK_RATES: Record<string, number> = {
  'USDC-EURC': 0.92,
  'EURC-USDC': 1.087,
}

// ─── Pure Functions ───────────────────────────────────────────────────────

/**
 * Hitung quote dari rate dan slippage.
 * @param fromAmount - Jumlah token asal (string)
 * @param rate       - Exchange rate: 1 fromToken = rate toToken
 * @param slippage   - Slippage tolerance dalam persen (misal "0.5")
 */
export function calculateQuote(
  fromAmount: string,
  rate: number,
  slippage: string,
): { toAmount: string; minReceived: string; priceImpact: number } {
  const from = parseFloat(fromAmount) || 0
  const to   = from * rate
  const slip = parseFloat(slippage) / 100
  const minReceived = to * (1 - slip)

  // Price impact simulasi — production: dari pool liquidity depth
  const priceImpact = from > 100_000 ? 3.5 : from > 10_000 ? 1.5 : 0.05

  return {
    toAmount:    to.toFixed(6),
    minReceived: minReceived.toFixed(6),
    priceImpact,
  }
}

export function getPriceImpactLevel(pct: number): 'low' | 'medium' | 'high' {
  if (pct < 1) return 'low'
  if (pct <= 3) return 'medium'
  return 'high'
}

export function getSlippageWarning(slippage: number): { showWarning: boolean } {
  return { showWarning: slippage > 5.0 }
}
