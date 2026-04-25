/**
 * lib/useSwapExecute.ts
 * Eksekusi swap di Arc Testnet via FxEscrow.
 *
 * kit.swap() TIDAK tersedia di Arc Testnet — langsung ERC-20 transfer ke FxEscrow.
 * Gas: dibayar USDC, selalu hardcode 100_000n.
 */
import { useState, useCallback } from 'react'
import { createWalletClient, custom, parseUnits, erc20Abi } from 'viem'
import {
  ARC_CHAIN_ID, ARC_CHAIN_ID_HEX, ARC_EXPLORER, ARC_FX_ESCROW, arcTestnet,
} from './arcChain'
import { calculateQuote, type TokenSymbol } from './swapTokens'
import { addTx, updateTx } from './txHistory'
import { getEvmProvider, NO_WALLET_MSG } from './evmProvider'
import { bsPollTxConfirmed } from './blockscout'

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
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState('')
  const [txHash, setTxHash] = useState('')

  const reset = useCallback(() => { setError(''); setTxHash('') }, [])

  async function switchToArc() {
    const eth = getEvmProvider()
    if (!eth) return
    try {
      await eth.request({ method: 'wallet_addEthereumChain', params: [ARC_CHAIN_PARAMS] })
    } catch (e: any) {
      if (e?.code !== 4001) {
        try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] }) }
        catch { /* ignore */ }
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
    if (!isArc) { await switchToArc(); return false }

    const amt = parseFloat(fromAmount)
    if (!fromAmount || isNaN(amt) || amt <= 0) { setError('Masukkan jumlah yang valid'); return false }

    setBusy(true); setError('')

    const { toAmount } = calculateQuote(fromAmount, rate, slippage)
    const txRecord = addTx({
      type: 'swap', status: 'pending',
      fromToken, toToken, fromAmount, toAmount, wallet: walletAddress,
    })

    try {
      onStatus?.('Menunggu konfirmasi wallet…')

      const walletClient = createWalletClient({
        chain:   arcTestnet,
        transport: custom(eth),
        account: walletAddress as `0x${string}`,
      }) as any

      // Coba estimateGas dulu, fallback ke hardcode
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
      } catch { /* Arc RPC sering return 0 — pakai hardcode */ }

      const hash = await walletClient.writeContract({
        address:      tokenAddress,
        abi:          erc20Abi,
        functionName: 'transfer',
        args:         [ARC_FX_ESCROW, parseUnits(fromAmount, 6)],
        account:      walletAddress as `0x${string}`,
        gas:          gasEstimate,
      })

      setTxHash(hash)
      onStatus?.('Menunggu konfirmasi on-chain…')
      updateTx(txRecord.id, { txHash: hash, toAmount, status: 'pending' }, walletAddress)

      const confirmed = await bsPollTxConfirmed(ARC_CHAIN_ID, hash, () => {}, 60_000)
      if (confirmed.status === 'ok') {
        updateTx(txRecord.id, { status: 'success' }, walletAddress)
        onStatus?.('Swap berhasil!')
      } else {
        updateTx(txRecord.id, { status: 'failed', errorMsg: 'Transaksi reverted' }, walletAddress)
        setError('Transaksi reverted di blockchain')
      }
      return confirmed.status === 'ok'

    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Swap gagal'
      setError(msg)
      updateTx(txRecord.id, { status: 'failed', errorMsg: msg }, walletAddress)
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, error, txHash, execute, reset }
}
