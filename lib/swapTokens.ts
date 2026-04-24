/**
 * lib/swapTokens.ts
 * Token constants, types, and pure utility functions for the Swap feature.
 */

import { ARC_USDC, ARC_EURC, ARC_USYC } from './arcChain'

// ─── Types ────────────────────────────────────────────────────────────────

export type TokenSymbol = 'USDC' | 'EURC' | 'USYC'

export interface TokenInfo {
  symbol: TokenSymbol
  name: string
  address: `0x${string}`
  decimals: number
  logoChar: string
}

// ─── Token List ───────────────────────────────────────────────────────────

export const SUPPORTED_TOKENS: TokenInfo[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: ARC_USDC,
    decimals: 6,
    logoChar: '$',
  },
  {
    symbol: 'EURC',
    name: 'Euro Coin',
    address: ARC_EURC,
    decimals: 6,
    logoChar: '€',
  },
  {
    symbol: 'USYC',
    name: 'US Yield Coin',
    address: ARC_USYC,
    decimals: 6,
    logoChar: '⚡',
  },
]

// ─── Mock Rates (Testnet) ─────────────────────────────────────────────────

export const MOCK_RATES: Record<string, number> = {
  'USDC-EURC': 0.92,
  'EURC-USDC': 1.087,
  'USDC-USYC': 0.98,
  'USYC-USDC': 1.02,
  'EURC-USYC': 1.065,
  'USYC-EURC': 0.939,
}

// ─── Feature Flag ─────────────────────────────────────────────────────────

/** Set to true when a live DEX is available on mainnet */
export const DEX_AVAILABLE = false

// ─── Pure Functions ───────────────────────────────────────────────────────

/**
 * Calculate swap quote values from input parameters.
 *
 * @param fromAmount - Amount of the source token as a string
 * @param rate       - Exchange rate: 1 fromToken = rate toToken
 * @param slippage   - Slippage tolerance as a percentage string (e.g. "0.5")
 * @returns toAmount, minReceived (both as 6-decimal strings), and priceImpact (%)
 */
export function calculateQuote(
  fromAmount: string,
  rate: number,
  slippage: string,
): { toAmount: string; minReceived: string; priceImpact: number } {
  const from = parseFloat(fromAmount) || 0
  const to = from * rate
  const slip = parseFloat(slippage) / 100
  const minReceived = to * (1 - slip)

  // Simulated price impact based on order size.
  // Production: derive from pool liquidity depth.
  const priceImpact = from > 100_000 ? 3.5 : from > 10_000 ? 1.5 : 0.05

  return {
    toAmount: to.toFixed(6),
    minReceived: minReceived.toFixed(6),
    priceImpact,
  }
}

/**
 * Classify a price impact percentage into a severity tier.
 *
 * @param priceImpact - Price impact as a percentage (0–100)
 * @returns 'low' (< 1%), 'medium' (1–3%), or 'high' (> 3%)
 */
export function getPriceImpactLevel(priceImpact: number): 'low' | 'medium' | 'high' {
  if (priceImpact < 1) return 'low'
  if (priceImpact <= 3) return 'medium'
  return 'high'
}

/**
 * Determine whether a high-slippage warning should be shown.
 *
 * @param slippage - Slippage tolerance as a number (e.g. 5.0)
 * @returns { showWarning: true } when slippage > 5%, false otherwise
 */
export function getSlippageWarning(slippage: number): { showWarning: boolean } {
  return { showWarning: slippage > 5.0 }
}
