/**
 * lib/useSwapExecute.ts
 * Hook untuk eksekusi swap di Arc Testnet via StableFX FxEscrow.
 *
 * CATATAN PENTING dari docs Circle:
 * - Circle App Kit swap() TIDAK tersedia di testnet
 *   Ref: https://arc-docs.mintlify.app/app-kit/swap
 *   "Swap is not available on Arc Testnet. Use mainnet for Swap."
 * - Di testnet, swap dilakukan via transfer langsung ke FxEscrow contract
 *   Ref: https://developers.circle.com/stablefx/references/contract-interfaces
 *   FxEscrow: 0x867650F5eAe8df91445971f14d89fd84F0C9a9f8
 * - Gas di Arc dibayar dengan USDC (native token), bukan ETH
 * - Selalu hardcode gas untuk Arc (RPC sering return estimasi = 0)
 */
import { useState, useCallback } from 'react'
import {
  createWalletClient, createPublicClient, custom, http, fallback,
  parseUnits, erc20Abi,
} from 'viem'
import {
  ARC_CHAIN_ID_HEX, ARC_RPC, ARC_RPC_BACKUP, ARC_RPC_BACKUP2,
  ARC_EXPLORER, ARC_FX_ESCROW, arcTestnet,
} from './arcChain'
import { FALLBACK_RATES, calculateQuote } from './swapTokens'
import { addTx, updateTx } from './txHistory'
import { getEvmProvider, NO_WALLET_MSG } from './evmProvider'

const ARC_CHAIN_PARAMS = {
  chainId:     ARC_CHAIN_ID_HEX,
  chainName:   'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls:     [ARC_RPC],
  blockExplorerUrls: [ARC_EXPLORER],
}

export interface SwapExecuteParams {
  fromToken:      string
  toToken:        string
  fromAmount:     string
  slippage:       string
  tokenAddresses: Record<string, `0x${string}`>
  walletAddress:  string | null
  isArc:          boolean
}

export interface SwapExecuteResult {
  txHash:      string
  toAmount:    string
  explorerUrl: string
}

export function useSwapExecute() {
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState('')
  const [txHash, setTxHash] = useState('')
  const [result, setResult] = useState<SwapExecuteResult | null>(null)

  const reset = useCallback(() => {
    setError(''); setTxHash(''); setResult(null)
  }, [])

  /** Switch ke Arc Testnet — force addEthereumChain agar override nama "Core" */
  const switchToArc = useCallback(async () => {
    const eth = getEvmProvider()
    if (!eth) return
    try {
      await eth.request({ method: 'wallet_addEthereumChain', params: [ARC_CHAIN_PARAMS] })
    } catch (e: any) {
      if (e?.code === 4001) return // user rejected
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] })
      } catch { /* ignore */ }
    }
  }, [])

  const execute = useCallback(async (params: SwapExecuteParams): Promise<boolean> => {
    const { fromToken, toToken, fromAmount, slippage, tokenAddresses, walletAddress, isArc } = params

    const eth = getEvmProvider()
    if (!eth) { alert(NO_WALLET_MSG); return false }

    let currentAddress = walletAddress
    if (!currentAddress) {
      try {
        const accs: string[] = await eth.request({ method: 'eth_requestAccounts' })
        currentAddress = accs?.[0] ?? null
        if (!currentAddress) return false
      } catch { return false }
    }

    if (!isArc) { await switchToArc(); return false }

    const amt = parseFloat(fromAmount)
    if (!fromAmount || isNaN(amt) || amt <= 0) {
      setError('Masukkan jumlah yang valid')
      return false
    }

    setBusy(true); setError(''); setTxHash('')

    const rate = FALLBACK_RATES[`${fromToken}-${toToken}`] ?? 1
    const { toAmount: estimatedOut } = calculateQuote(fromAmount, rate, slippage)

    const txRecord = addTx({
      type: 'swap', status: 'pending',
      fromToken, toToken, fromAmount, toAmount: estimatedOut,
      wallet: currentAddress,
    })

    try {
      const arcPublic = createPublicClient({
        chain: arcTestnet as any,
        transport: fallback([http(ARC_RPC), http(ARC_RPC_BACKUP), http(ARC_RPC_BACKUP2)]),
      }) as any

      const walletClient = createWalletClient({
        chain:     arcTestnet as any,
        transport: custom(eth),
        account:   currentAddress as `0x${string}`,
      }) as any

      const fromAddr = tokenAddresses[fromToken]
      if (!fromAddr) throw new Error(`Token address tidak ditemukan untuk ${fromToken}`)

      const amountUnits = parseUnits(fromAmount, 6)

      // Transfer ke FxEscrow — StableFX settlement contract
      // Ref: https://developers.circle.com/stablefx/references/contract-interfaces
      // FxEscrow: 0x867650F5eAe8df91445971f14d89fd84F0C9a9f8
      const hash = await walletClient.writeContract({
        address:      fromAddr,
        abi:          erc20Abi,
        functionName: 'transfer',
        args:         [ARC_FX_ESCROW, amountUnits],
        account:      currentAddress as `0x${string}`,
        gas:          100_000n, // Arc RPC sering return gasEstimate = 0
      })

      setTxHash(hash)
      updateTx(txRecord.id, { txHash: hash, toAmount: estimatedOut, status: 'pending' }, currentAddress)

      // Tunggu konfirmasi dengan manual polling (Arc finality instan ~1-2s)
      const deadline = Date.now() + 60_000
      let receipt: any = null
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1_500))
        try {
          receipt = await arcPublic.getTransactionReceipt({ hash })
          if (receipt?.status === 'success') break
          if (receipt?.status === 'reverted') throw new Error('Transaksi reverted')
        } catch (e: any) {
          if (e?.message?.includes('reverted')) throw e
        }
      }
      if (!receipt) throw new Error('Timeout menunggu konfirmasi di Arc')

      updateTx(txRecord.id, { status: 'success' }, currentAddress)

      const res: SwapExecuteResult = {
        txHash:      hash,
        toAmount:    estimatedOut,
        explorerUrl: `${ARC_EXPLORER}/tx/${hash}`,
      }
      setResult(res)
      return true

    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Swap gagal'
      setError(msg)
      updateTx(txRecord.id, { status: 'failed', errorMsg: msg }, currentAddress)
      return false
    } finally {
      setBusy(false)
    }
  }, [switchToArc])

  return { busy, error, txHash, result, execute, reset }
}
