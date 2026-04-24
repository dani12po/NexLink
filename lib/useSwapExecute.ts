/**
 * lib/useSwapExecute.ts
 * Hook untuk eksekusi swap via StableFX Escrow di Arc Testnet
 */
import { useState, useCallback } from 'react'
import {
  createWalletClient, createPublicClient, custom, http,
  parseUnits, erc20Abi,
} from 'viem'
import {
  ARC_CHAIN_ID_HEX, ARC_RPC, ARC_EXPLORER, ARC_FX_ESCROW, arcTestnet,
} from './arcChain'
import { MOCK_RATES, calculateQuote } from './swapTokens'
import { addTx, updateTx } from './txHistory'
import { getEvmProvider, NO_WALLET_MSG } from './evmProvider'

const ARC_CHAIN_PARAMS = {
  chainId: ARC_CHAIN_ID_HEX,
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: [ARC_RPC],
  blockExplorerUrls: [ARC_EXPLORER],
}

export interface SwapExecuteParams {
  fromToken: string
  toToken: string
  fromAmount: string
  slippage: string
  tokenAddresses: Record<string, `0x${string}`>
  walletAddress: string | null
  isArc: boolean
}

export interface SwapExecuteResult {
  txHash: string
  toAmount: string
  explorerUrl: string
}

export function useSwapExecute() {
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')
  const [txHash,  setTxHash]  = useState('')
  const [result,  setResult]  = useState<SwapExecuteResult | null>(null)

  const reset = useCallback(() => {
    setError(''); setTxHash(''); setResult(null)
  }, [])

  const switchToArc = useCallback(async () => {
    const eth = getEvmProvider()
    if (!eth) return
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] })
    } catch (e: any) {
      if (e?.code === 4902) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [ARC_CHAIN_PARAMS] })
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] })
      }
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

    const rate = MOCK_RATES[`${fromToken}-${toToken}`] ?? 1
    const { toAmount: estimatedOut } = calculateQuote(fromAmount, rate, slippage)

    const txRecord = addTx({
      type: 'swap', status: 'pending',
      fromToken, toToken, fromAmount, toAmount: estimatedOut,
      wallet: currentAddress,
    })

    try {
      const arcPublic = createPublicClient({ chain: arcTestnet as any, transport: http(ARC_RPC) }) as any
      const walletClient = createWalletClient({
        chain: arcTestnet as any,
        transport: custom(eth),
        account: currentAddress as `0x${string}`,
      }) as any

      const fromAddr = tokenAddresses[fromToken]
      if (!fromAddr) throw new Error(`Token address tidak ditemukan untuk ${fromToken}`)

      const amountUnits = parseUnits(fromAmount, 6)

      const hash = await walletClient.writeContract({
        address: fromAddr,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [ARC_FX_ESCROW, amountUnits],
        account: currentAddress as `0x${string}`,
      })

      setTxHash(hash)
      updateTx(txRecord.id, { txHash: hash, toAmount: estimatedOut, status: 'pending' }, currentAddress)

      await arcPublic.waitForTransactionReceipt({ hash, confirmations: 1 })
      updateTx(txRecord.id, { status: 'success' }, currentAddress)

      const res: SwapExecuteResult = {
        txHash: hash,
        toAmount: estimatedOut,
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
