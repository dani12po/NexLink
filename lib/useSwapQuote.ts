/**
 * lib/useSwapQuote.ts
 * Hook untuk swap quote dengan rate dari Circle App Kit estimateSwapRate().
 *
 * Ref: https://docs.arc.network/app-kit/tutorials/swap/estimate-swap-rate
 * Fallback ke FALLBACK_RATES jika App Kit tidak tersedia.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { calculateQuote, getPriceImpactLevel, FALLBACK_RATES } from './swapTokens'

export interface SwapQuote {
  toAmount:    string
  minReceived: string
  priceImpact: number
  impactLevel: 'low' | 'medium' | 'high'
  rate:        number
  countdown:   number
  lastRefresh: Date
  isLive:      boolean  // true = rate dari Circle API, false = fallback
}

const REFRESH_INTERVAL = 15 // detik

/**
 * Ambil rate dari Circle App Kit estimateSwapRate().
 * Ref: https://docs.arc.network/app-kit/tutorials/swap/estimate-swap-rate
 */
async function fetchLiveRate(
  fromToken: string,
  toToken:   string,
  amount:    string,
  kitKey:    string,
): Promise<number | null> {
  try {
    const { getAppKit }        = await import('./appKit')
    const { getBrowserAdapter } = await import('./appKitAdapter')
    const kit     = getAppKit()
    const adapter = await getBrowserAdapter()

    const estimate = await (kit as any).estimateSwapRate({
      from:     { adapter, chain: 'Arc_Testnet' },
      tokenIn:  fromToken,
      tokenOut: toToken,
      amountIn: amount,
      config:   { kitKey },
    })

    // estimateSwapRate returns { amountOut, rate, ... }
    if (estimate?.rate && typeof estimate.rate === 'number') return estimate.rate
    if (estimate?.amountOut) {
      const out = parseFloat(estimate.amountOut)
      const inp = parseFloat(amount)
      if (inp > 0 && out > 0) return out / inp
    }
  } catch { /* fallback */ }
  return null
}

export function useSwapQuote(
  fromToken: string,
  toToken:   string,
  fromAmount: string,
  slippage:   string,
): SwapQuote & { refresh: () => void } {
  const [countdown,   setCountdown]   = useState(REFRESH_INTERVAL)
  const [rate,        setRate]        = useState<number>(FALLBACK_RATES[`${fromToken}-${toToken}`] ?? 1)
  const [isLive,      setIsLive]      = useState(false)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const tickRef = useRef(0)

  const doFetch = useCallback(async () => {
    const kitKey = process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY || process.env.NEXT_PUBLIC_KIT_KEY
    if (!kitKey || !fromAmount || parseFloat(fromAmount) <= 0) {
      setRate(FALLBACK_RATES[`${fromToken}-${toToken}`] ?? 1)
      setIsLive(false)
      return
    }
    const live = await fetchLiveRate(fromToken, toToken, fromAmount, kitKey)
    if (live && live > 0) {
      setRate(live)
      setIsLive(true)
    } else {
      setRate(FALLBACK_RATES[`${fromToken}-${toToken}`] ?? 1)
      setIsLive(false)
    }
    setLastRefresh(new Date())
  }, [fromToken, toToken, fromAmount])

  // Fetch saat mount dan saat token/amount berubah
  useEffect(() => { doFetch() }, [doFetch])

  // Countdown + auto-refresh setiap 15 detik
  useEffect(() => {
    const id = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          tickRef.current++
          doFetch()
          return REFRESH_INTERVAL
        }
        return c - 1
      })
    }, 1_000)
    return () => clearInterval(id)
  }, [doFetch])

  const refresh = useCallback(() => {
    setCountdown(REFRESH_INTERVAL)
    doFetch()
  }, [doFetch])

  const { toAmount, minReceived, priceImpact } = calculateQuote(fromAmount, rate, slippage)
  const impactLevel = getPriceImpactLevel(priceImpact)

  return { toAmount, minReceived, priceImpact, impactLevel, rate, countdown, lastRefresh, isLive, refresh }
}
