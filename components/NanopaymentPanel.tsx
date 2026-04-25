/**
 * components/NanopaymentPanel.tsx
 * Direct ERC-20 USDC transfer di Arc Testnet.
 */
'use client'

import React, { useState } from 'react'
import { createWalletClient, custom, parseUnits, erc20Abi } from 'viem'
import {
  ARC_CHAIN_ID, ARC_CHAIN_ID_HEX, ARC_RPC, ARC_EXPLORER, ARC_USDC, arcTestnet,
} from '@/lib/arcChain'
import { useWallet } from './WalletButton'
import { getEvmProvider, NO_WALLET_MSG } from '@/lib/evmProvider'

const ARC_CHAIN_PARAMS = {
  chainId:           ARC_CHAIN_ID_HEX,
  chainName:         'Arc Testnet',
  nativeCurrency:    { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls:           [ARC_RPC],
  blockExplorerUrls: [ARC_EXPLORER],
}

function maskTx(h: string) {
  return h ? `${h.slice(0, 10)}…${h.slice(-8)}` : ''
}

export default function NanopaymentPanel() {
  const { address, chainId } = useWallet()
  const isArc = chainId === ARC_CHAIN_ID

  const [recipient, setRecipient] = useState('')
  const [amount,    setAmount]    = useState('0.001')
  const [busy,      setBusy]      = useState(false)
  const [txHash,    setTxHash]    = useState('')
  const [error,     setError]     = useState('')

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

  async function handleSend() {
    const eth = getEvmProvider()
    if (!eth) { alert(NO_WALLET_MSG); return }

    if (!address) {
      try {
        await eth.request({ method: 'eth_requestAccounts' })
      } catch { return }
    }

    if (!isArc) { await switchToArc(); return }

    const to = recipient.trim()
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) { setError('Recipient address tidak valid'); return }

    const amt = parseFloat(amount)
    if (!amount || isNaN(amt) || amt < 0.001) { setError('Minimum 0.001 USDC'); return }

    setBusy(true); setError(''); setTxHash('')

    try {
      const walletClient = createWalletClient({
        chain:     arcTestnet,
        transport: custom(eth),
        account:   address as `0x${string}`,
      }) as any

      const hash = await walletClient.writeContract({
        address:      ARC_USDC,
        abi:          erc20Abi,
        functionName: 'transfer',
        args:         [to as `0x${string}`, parseUnits(amount, 6)],
        account:      address as `0x${string}`,
        gas:          100_000n,
      })

      setTxHash(hash)
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'Transfer gagal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-zinc-600 px-1">
        Kirim USDC langsung ke address tujuan di Arc Testnet.
      </div>

      {/* Recipient */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Recipient Address</label>
        <input
          type="text" value={recipient}
          onChange={e => setRecipient(e.target.value)}
          disabled={busy} placeholder="0x…"
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600 disabled:opacity-50"
        />
      </div>

      {/* Amount */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">
          Jumlah USDC <span className="text-zinc-700">(min 0.001)</span>
        </label>
        <input
          type="number" min="0.001" step="0.001" value={amount}
          onChange={e => setAmount(e.target.value)}
          disabled={busy} placeholder="0.001"
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600 disabled:opacity-50"
        />
      </div>

      {/* Send button */}
      {!isArc && address ? (
        <button type="button" onClick={switchToArc}
          className="w-full py-3 rounded-xl border border-amber-800 bg-amber-500/10 text-sm font-semibold text-amber-300 transition-all">
          Switch ke Arc Testnet
        </button>
      ) : (
        <button type="button" onClick={handleSend} disabled={busy}
          className="w-full py-3 rounded-xl border border-purple-800 bg-purple-500/10 hover:bg-purple-500/15 hover:shadow-lg hover:shadow-purple-500/20 text-sm font-semibold disabled:opacity-50 transition-all">
          {busy ? 'Sending…' : `Send ${amount} USDC`}
        </button>
      )}

      {!address && <p className="text-center text-xs text-zinc-600">Connect wallet untuk send</p>}
      {error && <p className="text-xs text-red-400 text-center">{error}</p>}

      {txHash && (
        <a href={`${ARC_EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer"
          className="block text-center text-xs text-emerald-400 underline hover:text-emerald-300">
          ✅ Tx: {maskTx(txHash)} ↗
        </a>
      )}
    </div>
  )
}
