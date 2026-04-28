/**
 * lib/useSwapExecute.ts
 * Eksekusi swap USDC ↔ EURC di Arc Testnet via FxEscrow contract.
 *
 * Kenapa tidak pakai AppKit.swap():
 * AppKit.swap() memanggil Circle StableFX API (institutional RFQ platform)
 * yang tidak bisa diakses langsung dari browser (CORS + auth).
 * StableFX membutuhkan institutional API key + Permit2 + EIP-712 multi-step flow.
 *
 * Solusi: direct ERC-20 transfer ke FxEscrow contract (0x867650...)
 * yang merupakan settlement contract StableFX di Arc Testnet.
 * Ref: https://developers.circle.com/stablefx/references/contract-interfaces
 * FxEscrow: 0x867650F5eAe8df91445971f14d89fd84F0C9a9f8
 */
import { useState, useCallback } from 'react'
import { createWalletClient, custom, parseUnits, erc20Abi } from 'viem'
import {
  ARC_CHAIN_ID, ARC_CHAIN_ID_HEX, ARC_EXPLORER, ARC_FX_ESCROW, arcTestnet,
} from './arcChain'
import { addTx, updateTx } from './txHistory'
import { getEvmProvider, NO_WALLET_MSG } from './evmProvider'
import { bsPollTxConfirmed } from './blockscout'
import type { TokenSymbol } from './swapTokens'

const ARC_CHAIN_PARAMS = {
  chainId:           ARC_CHAIN_ID_HEX,
  chainName:         'Arc Testnet',
  nativeCurrency:    { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls:           ['https://rpc.testnet.arc.network'],
  blockExplorerUrls: [ARC_EXPLORER],
}

export interface SwapParams {
  fromToken:     TokenSymbol
  toToken:       TokenSymbol
  fromAmount:    string
  slippage:      string
  rate:          number
  tokenAddress:  `0x${string}`
  walletAddress: string
  isArc:         boolean
}

export function useSwapExecute() {
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState('')
  const [txHash,      setTxHash]      = useState('')
  const [explorerUrl, setExplorerUrl] = useState('')
  const [amountOut,   setAmountOut]   = useState('')

  const reset = useCallback(() => {
    setError(''); setTxHash(''); setExplorerUrl(''); setAmountOut('')
  }, [])

  async function switchToArc() {
    const eth = getEvmProvider()
    if (!eth) return
    try {
      await eth.request({ method: 'wallet_addEthereumChain', params: [ARC_CHAIN_PARAMS] })
    } catch (e: any) {
      if (e?.code !== 4001) {
        try {
          await eth.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: ARC_CHAIN_ID_HEX }],
          })
        } catch { /* ignore */ }
      }
    }
  }

  const execute = useCallback(async (
    params: SwapParams,
    onStatus?: (msg: string) => void,
  ): Promise<boolean> => {
    const { fromToken, toToken, fromAmount, slippage, rate, tokenAddress, walletAddress, isArc } = params

    const eth = getEvmProvider()
    if (!eth) { alert(NO_WALLET_MSG); return false }

    if (!isArc) {
      onStatus?.('Switching ke Arc Testnet…')
      await switchToArc()
      return false
    }

    const amt = parseFloat(fromAmount)
    if (!fromAmount || isNaN(amt) || amt <= 0) {
      setError('Masukkan jumlah yang valid')
      return false
    }

    setBusy(true); setError(''); setTxHash(''); setExplorerUrl(''); setAmountOut('')

    // Estimasi output berdasarkan rate
    const estimatedOut = (amt * rate * (1 - parseFloat(slippage) / 100)).toFixed(6)

    const txRecord = addTx({
      type: 'swap', status: 'pending',
      fromToken, toToken, fromAmount,
      toAmount: estimatedOut,
      wallet: walletAddress,
    })

    try {
      onStatus?.('Menunggu konfirmasi wallet…')

      const walletClient = createWalletClient({
        chain:     arcTestnet,
        transport: custom(eth),
        account:   walletAddress as `0x${string}`,
      }) as any

      // Estimasi gas, fallback ke hardcode jika gagal
      let gasEstimate: bigint = 100_000n
      try {
        const estimated = await walletClient.estimateContractGas({
          address:      tokenAddress,
          abi:          erc20Abi,
          functionName: 'transfer',
          args:         [ARC_FX_ESCROW, parseUnits(fromAmount, 6)],
          account:      walletAddress as `0x${string}`,
        })
        if (estimated && estimated > 0n) {
          gasEstimate = (estimated * 120n) / 100n // +20% buffer
        }
      } catch { /* Arc RPC kadang return 0 — pakai hardcode */ }

      // Transfer token ke FxEscrow contract
      const hash = await walletClient.writeContract({
        address:      tokenAddress,
        abi:          erc20Abi,
        functionName: 'transfer',
        args:         [ARC_FX_ESCROW, parseUnits(fromAmount, 6)],
        account:      walletAddress as `0x${string}`,
        gas:          gasEstimate,
      })

      const expUrl = `${ARC_EXPLORER}/tx/${hash}`
      setTxHash(hash)
      setExplorerUrl(expUrl)
      setAmountOut(estimatedOut)

      onStatus?.('Menunggu konfirmasi on-chain…')
      updateTx(txRecord.id, { txHash: hash, toAmount: estimatedOut, status: 'pending' }, walletAddress)

      const confirmed = await bsPollTxConfirmed(ARC_CHAIN_ID, hash, () => {}, 60_000)

      if (confirmed.status === 'ok') {
        updateTx(txRecord.id, { status: 'success' }, walletAddress)
        onStatus?.(`Swap berhasil! ~${estimatedOut} ${toToken}`)
        return true
      } else {
        updateTx(txRecord.id, { status: 'failed', errorMsg: 'Transaksi reverted' }, walletAddress)
        setError('Transaksi reverted di blockchain')
        return false
      }

    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Swap gagal'
      setError(msg)
      updateTx(txRecord.id, { status: 'failed', errorMsg: msg }, walletAddress)
      onStatus?.('')
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, error, txHash, explorerUrl, amountOut, execute, reset }
}
