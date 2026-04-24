/**
 * lib/swapTokens.test.ts
 * Property-based tests for pure functions in lib/swapTokens.ts
 *
 * Feature: swap-tab-feature
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { calculateQuote, getPriceImpactLevel, getSlippageWarning, MOCK_RATES } from './swapTokens'

// ─── Property 4: Quote calculation correctness ────────────────────────────
// Validates: Requirements 3.1, 3.5
describe('calculateQuote — Property 4: Quote calculation correctness', () => {
  it('toAmount ≈ fromAmount * rate and minReceived ≈ toAmount * (1 - slippage/100)', () => {
    // Feature: swap-tab-feature, Property 4: Quote calculation correctness
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.000001), max: 1_000_000, noNaN: true }),
        fc.constantFrom(
          'USDC-EURC',
          'EURC-USDC',
          'USDC-USYC',
          'USYC-USDC',
          'EURC-USYC',
          'USYC-EURC',
        ),
        fc.float({ min: Math.fround(0.01), max: 50, noNaN: true }),
        (fromAmount, pair, slippage) => {
          const rate = MOCK_RATES[pair]
          const result = calculateQuote(fromAmount.toString(), rate, slippage.toString())

          const expectedTo = fromAmount * rate
          const expectedMin = expectedTo * (1 - slippage / 100)

          const actualTo = parseFloat(result.toAmount)
          const actualMin = parseFloat(result.minReceived)

          const TOLERANCE = 0.000001

          expect(Math.abs(actualTo - expectedTo)).toBeLessThanOrEqual(
            Math.abs(expectedTo) * TOLERANCE + TOLERANCE,
          )
          expect(Math.abs(actualMin - expectedMin)).toBeLessThanOrEqual(
            Math.abs(expectedMin) * TOLERANCE + TOLERANCE,
          )
        },
      ),
      { numRuns: 25 },
    )
  })

  it('boundary: explicit edge values produce correct results', () => {
    // fromAmount = 1, rate = 0.92 (USDC→EURC), slippage = 0.5
    const r1 = calculateQuote('1', 0.92, '0.5')
    expect(parseFloat(r1.toAmount)).toBeCloseTo(0.92, 5)
    expect(parseFloat(r1.minReceived)).toBeCloseTo(0.92 * (1 - 0.005), 5)

    // fromAmount = 0 → toAmount and minReceived should be 0
    const r2 = calculateQuote('0', 1.087, '1.0')
    expect(parseFloat(r2.toAmount)).toBe(0)
    expect(parseFloat(r2.minReceived)).toBe(0)
  })
})

// ─── Property 8: Price impact indicator color tier ────────────────────────
// Validates: Requirements 6.1, 6.2, 6.3
describe('getPriceImpactLevel — Property 8: Price impact indicator color tier', () => {
  it('classifies all values in [0, 20] into the correct tier', () => {
    // Feature: swap-tab-feature, Property 8: Price impact indicator color tier
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 20, noNaN: true }),
        (priceImpact) => {
          const level = getPriceImpactLevel(priceImpact)
          if (priceImpact < 1) {
            expect(level).toBe('low')
          } else if (priceImpact <= 3) {
            expect(level).toBe('medium')
          } else {
            expect(level).toBe('high')
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('boundary values 1.0 and 3.0 classify correctly', () => {
    // Exactly 1.0 → medium (1 <= p <= 3)
    expect(getPriceImpactLevel(1.0)).toBe('medium')
    // Exactly 3.0 → medium (1 <= p <= 3)
    expect(getPriceImpactLevel(3.0)).toBe('medium')
    // Just below 1 → low
    expect(getPriceImpactLevel(0.9999)).toBe('low')
    // Just above 3 → high
    expect(getPriceImpactLevel(3.0001)).toBe('high')
    // Zero → low
    expect(getPriceImpactLevel(0)).toBe('low')
  })
})

// ─── Property 7: High slippage warning threshold ──────────────────────────
// Validates: Requirements 4.5
describe('getSlippageWarning — Property 7: High slippage warning threshold', () => {
  it('shows warning when slippage > 5.0, hides it when <= 5.0', () => {
    // Feature: swap-tab-feature, Property 7: High slippage warning threshold
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 100, noNaN: true }),
        (slippage) => {
          const { showWarning } = getSlippageWarning(slippage)
          if (slippage > 5.0) {
            expect(showWarning).toBe(true)
          } else {
            expect(showWarning).toBe(false)
          }
        },
      ),
      { numRuns: 25 },
    )
  })

  it('edge values 5.0, 5.001, and 4.999 are classified correctly', () => {
    expect(getSlippageWarning(5.0).showWarning).toBe(false)
    expect(getSlippageWarning(5.001).showWarning).toBe(true)
    expect(getSlippageWarning(4.999).showWarning).toBe(false)
    // Zero → no warning
    expect(getSlippageWarning(0).showWarning).toBe(false)
    // 100 → warning
    expect(getSlippageWarning(100).showWarning).toBe(true)
  })
})
