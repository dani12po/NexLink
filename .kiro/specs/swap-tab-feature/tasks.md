# Implementation Plan: Swap Tab Feature

## Overview

Upgrade the existing `SwapPanel.tsx` into a full-featured swap UI with token selection, slippage settings, quote auto-refresh, and price impact indicators — all in a coming-soon/disabled state while `DEX_AVAILABLE = false`. Logic is split into `lib/swapTokens.ts` (pure functions), `hooks/useSwapQuote.ts`, and `hooks/useSwapExecute.ts`. Property-based tests use fast-check via Vitest.

## Tasks

- [x] 1. Set up test framework and token constants
  - Install Vitest, @vitest/ui, jsdom, @testing-library/react, @testing-library/jest-dom, and fast-check as dev dependencies
  - Create `vitest.config.ts` at project root with jsdom environment and path aliases matching `tsconfig.json`
  - Create `lib/swapTokens.ts` with:
    - `TokenSymbol` type (`'USDC' | 'EURC' | 'USYC'`)
    - `TokenInfo` interface (symbol, name, address, decimals, logoChar)
    - `SUPPORTED_TOKENS: TokenInfo[]` array with USDC, EURC, USYC using addresses from `lib/arcChain.ts`
    - `MOCK_RATES: Record<string, number>` with all 6 pair combinations
    - `DEX_AVAILABLE = false` constant
    - `calculateQuote(fromAmount: string, rate: number, slippage: string)` pure function returning `{ toAmount, minReceived, priceImpact }`
    - `getPriceImpactLevel(priceImpact: number): 'low' | 'medium' | 'high'` pure function
    - `getSlippageWarning(slippage: number): { showWarning: boolean }` pure function
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.5, 4.5, 6.1, 6.2, 6.3, 8.1, 8.7_

  - [-] 1.1 Write property test for `calculateQuote` — Property 4
    - **Property 4: Quote calculation correctness**
    - For any positive `fromAmount`, known pair rate `r`, and slippage `s`: `toAmount ≈ fromAmount * r` (tolerance 0.000001) and `minReceived ≈ toAmount * (1 - s/100)`
    - Use `fc.float({ min: 0.000001, max: 1_000_000 })` for amounts and `fc.float({ min: 0.01, max: 50 })` for slippage
    - **Validates: Requirements 3.1, 3.5**

  - [-] 1.2 Write property test for `getPriceImpactLevel` — Property 8
    - **Property 8: Price impact indicator color tier**
    - For any `p` in `[0, 20]`: `p < 1` → `'low'`, `1 <= p <= 3` → `'medium'`, `p > 3` → `'high'`; boundary values 1.0 and 3.0 must classify correctly
    - Use `fc.float({ min: 0, max: 20 })` including boundary sampling
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [-] 1.3 Write property test for `getSlippageWarning` — Property 7
    - **Property 7: High slippage warning threshold**
    - For any `s` in `[0, 100]`: `s > 5.0` → `showWarning = true`, `s <= 5.0` → `showWarning = false`; edge values 5.0, 5.001, 4.999 must be correct
    - Use `fc.float({ min: 0, max: 100 })` with explicit boundary checks
    - **Validates: Requirements 4.5**

- [ ] 2. Implement `hooks/useSwapQuote.ts`
  - Create `hooks/` directory and `hooks/useSwapQuote.ts`
  - Implement `useSwapQuote(input: SwapQuoteInput): SwapQuoteResult` hook with:
    - Quote calculation via `calculateQuote` from `lib/swapTokens.ts`
    - `countdown` state (0–15) decremented every second via `setInterval`
    - Auto-refresh every 15 seconds: resets countdown to 15 and recalculates quote
    - Manual `refresh()` function that immediately recalculates and resets countdown to 15
    - `gasFeeEstimate` as a static readable string (e.g. `"~0.001 USDC"`) since DEX is unavailable
    - `isLoading` boolean, `lastRefreshed: Date`
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.2, 8.7_

  - [ ] 2.1 Write unit tests for `useSwapQuote`
    - Test initial state: `countdown` is 15, `isLoading` is false after first render
    - Test manual `refresh()` resets countdown to 15 using Vitest fake timers
    - Test auto-refresh fires after 15 seconds using fake timers
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 3. Implement `hooks/useSwapExecute.ts`
  - Create `hooks/useSwapExecute.ts`
  - Implement `useSwapExecute(): SwapExecuteResult` hook with:
    - `execute(params: SwapExecuteParams): Promise<void>` that checks `DEX_AVAILABLE`; if false, sets `status = 'error'` and `error = 'Swap akan tersedia saat mainnet launch'` without making any wallet calls
    - Status transitions: `'idle' → 'pending' → 'success' | 'error'`
    - `reset()` function that returns state to `{ status: 'idle', txHash: null, error: null }`
    - `txHash: string | null`, `error: string | null`
  - _Requirements: 3.7, 3.8, 8.3, 8.7_

  - [ ] 3.1 Write unit tests for `useSwapExecute`
    - Test that `execute()` sets `status = 'error'` with coming-soon message when `DEX_AVAILABLE = false`
    - Test `reset()` returns to idle state
    - _Requirements: 3.8_

- [ ] 4. Implement `components/TokenSelector.tsx`
  - Create `components/TokenSelector.tsx` with `TokenSelectorProps` interface
  - Render a button showing current token symbol + logoChar; clicking opens a modal overlay
  - Modal lists all `SUPPORTED_TOKENS` with name, symbol, and balance from `balances` prop
  - Highlight the currently selected token; if a token matches `excludeToken`, render it visually distinct and non-selectable (grayed out)
  - Close modal on outside click (use a backdrop div with `onClick`)
  - Apply design system: `bg-zinc-900`, `border-zinc-800`, `rounded-xl`, `text-zinc-100/500`, `hover:bg-zinc-800`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 8.4, 8.7, 8.8, 9.1, 9.2, 9.3_

  - [ ] 4.1 Write property test for TokenSelector token display — Property 3
    - **Property 3: Token selector displays all required fields**
    - For any list of tokens with associated balances, every rendered token entry must show name, symbol, and balance
    - Use `fc.record` to generate arbitrary balance maps and verify all three fields are present in the rendered output
    - **Validates: Requirements 2.4**

- [ ] 5. Implement `components/SlippageSettings.tsx`
  - Create `components/SlippageSettings.tsx` with `SlippageSettingsProps` interface
  - Render three preset buttons: `0.1%`, `0.5%`, `1.0%`; highlight the active preset with `border-emerald-700 bg-emerald-500/10 text-emerald-300`
  - Render a custom numeric input field; typing updates `value` via `onChange`
  - When `parseFloat(value) > 5`, render a visible warning: `"⚠️ Slippage tinggi — risiko eksekusi harga buruk"`
  - Use `getSlippageWarning` from `lib/swapTokens.ts` for the warning condition
  - Default value is `'0.5'` (controlled by parent)
  - Apply design system styling consistent with existing panels
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 8.5, 8.7, 8.8, 9.2_

  - [ ] 5.1 Write unit tests for `SlippageSettings`
    - Test default value `0.5` preset is highlighted on initial render
    - Test all three preset buttons render with correct values
    - Test warning appears when value `> 5` and disappears when `<= 5`
    - _Requirements: 4.2, 4.5, 4.6_

- [ ] 6. Implement `components/SwapPanel.tsx` (full upgrade)
  - Replace the existing `components/SwapPanel.tsx` with the upgraded version
  - Internal state: `fromToken` (default `'USDC'`), `toToken` (default `'EURC'`), `fromAmount` (default `''`), `showSlippage`, `showConfirmModal`, `isReversing`, `slippage` (default `'0.5'`)
  - Fetch ERC-20 balances for all three tokens via `arcPublicClient.readContract` using `erc20Abi.balanceOf`; pass as `balances` to `TokenSelector`
  - Wire `useSwapQuote` with `{ fromToken, toToken, fromAmount, slippage }` and display: `toAmount`, rate string `"1 FROM = r TO"`, price impact with `getPriceImpactLevel` color tiers, `minReceived`, `gasFeeEstimate`, countdown timer, manual refresh button
  - Render coming-soon banner: `"🚧 Swap akan tersedia saat mainnet launch"` with amber styling; always visible when `DEX_AVAILABLE = false`
  - FROM field: `<input>` for amount + `<TokenSelector>` with `excludeToken={toToken}`
  - ReverseButton (⇄): centered between FROM and TO; on click, swap `fromToken`/`toToken` and set `fromAmount` to current `toAmount`; add `isReversing` CSS class for rotation animation; disable when `useSwapExecute.status === 'pending'`
  - TO field: read-only amount display + `<TokenSelector>` with `excludeToken={fromToken}`
  - `<SlippageSettings>` panel toggled by ⚙️ button in header
  - Price impact indicator: green + ✓ for `'low'`, yellow + ⚠️ for `'medium'`, red + ✗ + extra warning text for `'high'`
  - Swap button: disabled when `!address || !fromAmount || DEX_AVAILABLE === false`; shows `"Connect wallet untuk swap"` when no wallet, `"Switch ke Arc Testnet"` (amber) when wrong chain, otherwise `"Swap [amount] [FROM] → [TO]"` (disabled sky styling)
  - ConfirmationModal: renders when `showConfirmModal = true`; shows rate, minReceived, priceImpact, gas; Confirm calls `useSwapExecute.execute()`; Cancel closes modal
  - _Requirements: 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 5.3, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 8.1, 8.7, 8.8, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ] 6.1 Write property test for no identical token pair — Property 2
    - **Property 2: No identical token pair**
    - For any `(selectedToken, currentOtherToken)` pair from `SUPPORTED_TOKENS`, after selecting `selectedToken` for FROM when TO already equals `selectedToken`, `fromToken !== toToken` must hold
    - Use `fc.constantFrom('USDC', 'EURC', 'USYC')` for both tokens
    - **Validates: Requirements 2.7**

  - [ ] 6.2 Write property test for active tab styling invariant — Property 1
    - **Property 1: Active tab styling invariant**
    - For any `activeTab` in `{ 'bridge', 'swap' }`, the active button has `bg-zinc-800` and `text-zinc-100`; the inactive button has `text-zinc-500`
    - Render `app/dapp/page.tsx` tab nav section with each tab value and assert CSS classes
    - Use `fc.constantFrom('bridge', 'swap')`
    - **Validates: Requirements 1.5, 1.6**

  - [ ] 6.3 Write property test for reverse button involution — Property 9
    - **Property 9: Reverse button is an involution**
    - For any `(fromToken, toToken, fromAmount)` where `fromToken !== toToken`: after one reverse, tokens are swapped; after a second reverse, state returns to original
    - Use `fc.constantFrom` for tokens and `fc.float({ min: 0.01, max: 10000 })` for amounts
    - **Validates: Requirements 7.2**

- [ ] 7. Checkpoint — Ensure all tests pass
  - Run `npx vitest --run` and confirm all unit and property tests pass
  - Fix any type errors reported by TypeScript (`npx tsc --noEmit`)
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Verify `app/dapp/page.tsx` integration
  - Confirm `app/dapp/page.tsx` already imports `SwapPanel` via dynamic import with `ssr: false`
  - Confirm the tab navigation renders both `🌉 Bridge` and `🔄 Swap` buttons with identical sizing and the correct active/inactive CSS classes
  - Confirm the `tab === 'swap'` branch renders `<SwapPanel />` inside the existing panel wrapper
  - If any of the above is missing or incorrect, apply the minimal fix to `app/dapp/page.tsx`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 8.6, 9.4_

- [ ] 9. Final checkpoint — Ensure all tests pass
  - Run `npx vitest --run` to confirm full test suite is green
  - Run `npx tsc --noEmit` to confirm no TypeScript errors across all new files
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- `DEX_AVAILABLE = false` in `lib/swapTokens.ts` is the single flag to flip when mainnet DEX is ready
- Property tests require fast-check; install it alongside Vitest in Task 1
- Each property test references a specific design property number for traceability
- All new files use `'use client'` directive where React hooks or browser APIs are used
- Token addresses are imported from `lib/arcChain.ts` — never hardcoded in new files
