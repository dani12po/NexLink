/**
 * components/NanopaymentPanel.tsx
 * x402 Nanopayment — kirim micropayment USDC via HTTP 402 protocol
 * Sumber: https://developers.circle.com/gateway/nanopayments
 *         https://docs.x402.org
 *
 * Flow:
 * 1. User isi recipient + amount
 * 2. Klik "Send" → build EIP-3009 signature
 * 3. POST ke /api/x402/pay dengan X-PAYMENT header
 * 4. Server verifikasi → eksekusi transferWithAuthorization onchain
 */
'use client'

import React, { useState } from 'react'
import {
  createPublicClient, createWalletClient, custom, http,
  parseUnits, erc20Abi,
} from 'viem'
import {
  ARC_CHAIN_ID, ARC_CHAIN_ID_HEX, ARC_RPC, ARC_EXPLORER, ARC_USDC, arcTestnet,
} from '@/lib/arcChain'
import { useWallet } from './WalletButton'
import { getEvmProvider, NO_WALLET_MSG } from '@/lib/evmProvider'

const arcPublicClient = createPublicClient({ chain: arcTestnet as any, transport: http(ARC_RPC) }) as any

function maskTx(h: string) {
  return h ? `${h.slice(0, 10)}…${h.slice(-8)}` : ''
}

export default function NanopaymentPanel() {
  const { address, chainId } = useWallet()
  const isArc = chainId === ARC_CHAIN_ID

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('0.001')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [txHash, setTxHash] = useState('')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'direct' | 'x402'>('direct')

  async function switchToArc() {
    const eth = getEvmProvider()
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] })
    } catch (e: any) {
      if (e?.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: ARC_CHAIN_ID_HEX, chainName: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: [ARC_RPC], blockExplorerUrls: [ARC_EXPLORER] }],
        })
      }
    }
  }

  /** Mode 1: Direct ERC-20 transfer (simple) */
  async function sendDirect() {
    const eth = getEvmProvider()
    if (!eth) { alert(NO_WALLET_MSG); return }

    // If not connected, request connection first
    if (!address) {
      try {
        await eth.request({ method: 'eth_requestAccounts' })
        const accs = await eth.request({ method: 'eth_accounts' })
        if (!accs?.[0]) return // user rejected
      } catch { return }
    }

    if (!isArc) { await switchToArc(); return }

    const to = recipient.trim() as `0x${string}`
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) { setError('Recipient address tidak valid'); return }

    const amt = parseFloat(amount)
    if (!amount || isNaN(amt) || amt < 0.000001) { setError('Minimum 0.000001 USDC'); return }

    setBusy(true); setError(''); setTxHash('')

    try {
      const walletClient = createWalletClient({ chain: arcTestnet as any, transport: custom(eth), account: address as `0x${string}` }) as any
      const amountUnits = parseUnits(amount, 6)

      const hash = await walletClient.writeContract({
        address: ARC_USDC, abi: erc20Abi, functionName: 'transfer',
        args: [to, amountUnits], account: address as `0x${string}`,
      })
      setTxHash(hash)
      await arcPublicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'Transfer gagal')
    } finally {
      setBusy(false)
    }
  }

  /** Mode 2: x402 payment via HTTP protocol */
  async function sendX402() {
    const eth = getEvmProvider()
    if (!eth) { alert(NO_WALLET_MSG); return }

    // If not connected, request connection first
    if (!address) {
      try {
        await eth.request({ method: 'eth_requestAccounts' })
        const accs = await eth.request({ method: 'eth_accounts' })
        if (!accs?.[0]) return // user rejected
      } catch { return }
    }

    if (!isArc) { await switchToArc(); return }

    const to = recipient.trim() as `0x${string}`
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) { setError('Recipient address tidak valid'); return }

    const amt = parseFloat(amount)
    if (!amount || isNaN(amt) || amt < 0.001) { setError('Minimum 0.001 USDC untuk x402'); return }

    setBusy(true); setError(''); setTxHash('')

    try {
      // Step 1: Request ke endpoint x402 → dapat 402 + payment terms
      const resourceUrl = `${window.location.origin}/api/x402/pay`
      const firstRes = await fetch(resourceUrl, { method: 'GET' })

      if (firstRes.status !== 402) {
        setError('Endpoint tidak mendukung x402 atau sudah dikonfigurasi berbeda')
        return
      }

      const paymentTerms = await firstRes.json()
      const requirement = paymentTerms?.accepts?.[0]
      if (!requirement) { setError('Payment requirement tidak valid'); return }

      // Step 2: Build EIP-3009 signature
      const walletClient = createWalletClient({ chain: arcTestnet as any, transport: custom(eth), account: address as `0x${string}` }) as any
      const amountUnits = parseUnits(amount, 6)
      const validAfter = BigInt(Math.floor(Date.now() / 1000) - 10)
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 60)
      const nonce = `0x${crypto.randomUUID().replace(/-/g, '')}` as `0x${string}`

      const signature = await walletClient.signTypedData({
        account: address as `0x${string}`,
        domain: { name: 'USD Coin', version: '2', chainId: ARC_CHAIN_ID, verifyingContract: ARC_USDC },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: { from: address as `0x${string}`, to, value: amountUnits, validAfter, validBefore, nonce },
      })

      const paymentHeader = btoa(JSON.stringify({
        x402Version: 1, scheme: 'exact',
        network: `eip155:${ARC_CHAIN_ID}`,
        payload: {
          signature,
          authorization: {
            from: address, to, value: amountUnits.toString(),
            validAfter: validAfter.toString(), validBefore: validBefore.toString(), nonce,
          },
        },
      }))

      // Step 3: Retry dengan payment header
      const paidRes = await fetch(resourceUrl, {
        method: 'GET',
        headers: { 'X-PAYMENT': paymentHeader, 'X-402-Version': '1' },
      })

      if (paidRes.ok) {
        const data = await paidRes.json()
        setTxHash(data?.txHash || data?.data?.txHash || 'x402-payment-sent')
      } else {
        const err = await paidRes.json()
        setError(err?.error || 'x402 payment gagal')
      }
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'x402 payment gagal')
    } finally {
      setBusy(false)
    }
  }

  const send = mode === 'direct' ? sendDirect : sendX402

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('direct')}
          className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${mode === 'direct' ? 'border-purple-700 bg-purple-500/10 text-purple-300' : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
          Direct Transfer
        </button>
        <button type="button" onClick={() => setMode('x402')}
          className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${mode === 'x402' ? 'border-orange-700 bg-orange-500/10 text-orange-300' : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
          x402 Protocol
        </button>
      </div>

      {/* Mode description */}
      <div className="text-xs text-zinc-600 px-1">
        {mode === 'direct'
          ? 'Transfer USDC langsung via ERC-20 transfer ke address tujuan.'
          : 'Kirim micropayment via HTTP 402 protocol — standard untuk AI agents & API payments.'}
      </div>

      {/* Recipient — hanya untuk Direct Transfer */}
      {mode === 'direct' && (
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Recipient Address</label>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={busy}
          placeholder="0x…"
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600 disabled:opacity-50"
        />
      </div>
      )}

      {/* x402 mode: info recipient */}
      {mode === 'x402' && (
        <div className="px-3 py-2 rounded-lg border border-orange-900/30 bg-orange-500/5 text-xs text-orange-400/80">
          💡 Mode x402: pembayaran dikirim ke <span className="font-mono">X402_RECEIVER_ADDRESS</span> yang dikonfigurasi di server. Bukan ke address custom.
        </div>
      )}

      {/* Amount */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">
          Jumlah USDC <span className="text-zinc-700">(min {mode === 'x402' ? '0.001' : '0.000001'})</span>
        </label>
        <input type="number" min="0.000001" step="0.001" value={amount}
          onChange={(e) => setAmount(e.target.value)} disabled={busy}
          placeholder="0.001"
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600 disabled:opacity-50"
        />
      </div>

      {/* Memo (optional) */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Memo <span className="text-zinc-700">(opsional)</span></label>
        <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} disabled={busy}
          placeholder="Catatan pembayaran…"
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
        <button type="button" onClick={send} disabled={busy}
          className={`w-full py-3 rounded-xl border text-sm font-semibold disabled:opacity-50 transition-all ${
            mode === 'x402'
              ? 'border-orange-800 bg-orange-500/10 hover:bg-orange-500/15 hover:shadow-lg hover:shadow-orange-500/20'
              : 'border-purple-800 bg-purple-500/10 hover:bg-purple-500/15 hover:shadow-lg hover:shadow-purple-500/20'
          }`}>
          {busy ? 'Sending…' : mode === 'x402' ? `Send ${amount} USDC via x402` : `Send ${amount} USDC`}
        </button>
      )}



      {error && <p className="text-xs text-red-400 text-center">{error}</p>}

      {txHash && (
        <div className="text-center">
          {txHash.startsWith('0x') ? (
            <a href={`${ARC_EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer"
              className="text-xs text-emerald-400 underline hover:text-emerald-300">
              ✅ Tx: {maskTx(txHash)} ↗
            </a>
          ) : (
            <p className="text-xs text-emerald-400">✅ {txHash}</p>
          )}
        </div>
      )}

      {/* x402 info */}
      {mode === 'x402' && (
        <div className="border border-orange-900/40 rounded-xl p-3 bg-orange-500/5 text-xs text-zinc-500 space-y-1">
          <p className="text-orange-300 font-medium">Tentang x402 Protocol</p>
          <p>HTTP 402 "Payment Required" — standard untuk machine-to-machine payments.</p>
          <p>Digunakan oleh AI agents untuk bayar API secara otomatis tanpa akun/subscription.</p>
          <a href="https://x402.org" target="_blank" rel="noreferrer" className="text-orange-400 underline hover:text-orange-300">
            Pelajari lebih lanjut di x402.org ↗
          </a>
        </div>
      )}
    </div>
  )
}
