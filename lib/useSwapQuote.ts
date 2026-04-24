/**
 * lib/useSwapQuote.ts
 * Hook untuk kalkulasi swap quote dengan countdown timer 15 detik
 */
import { useState, useEffect, useCallback } from 'react'
import { calculateQuote, getPriceImpactLevel, MOCK_RATES } from './swapTokens'

export interface SwapQuote {
  toAmount: string
  minReceived: string
  priceImpact: number
  impactLevel: 'low' | 'medium' | 'high'
  rate: number
  countdown: number       // detik tersisa sebelum refresh
  lastRefresh: Date
}

const REFRESH_INTERVAL = 15 // detik

export function useSwapQuote(
  fromToken: string,
  toToken: string,
  fromAmount: string,
  slippage: string,
): SwapQuote & { refresh: () => void } {
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL)
  const [tick,      setTick]      = useState(0)

  // Countdown tick setiap detik
  useEffect(() => {
    const id = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          setTick(t => t + 1) // trigger re-quote
          return REFRESH_INTERVAL
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const refresh = useCallback(() => {
    setTick(t => t + 1)
    setCountdown(REFRESH_INTERVAL)
  }, [])

  const rate = MOCK_RATES[`${fromToken}-${toToken}`] ?? 1
  const { toAmount, minReceived, priceImpact } = calculateQuote(fromAmount, rate, slippage)
  const impactLevel = getPriceImpactLevel(priceImpact)

  return {
    toAmount,
    minReceived,
    priceImpact,
    impactLevel,
    rate,
    countdown,
    lastRefresh: new Date(),
    refresh,
  }
}
