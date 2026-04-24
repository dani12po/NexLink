/**
 * components/BridgePanel.tsx
 * Bridge USDC: Ethereum Sepolia ↔ Arc Testnet via Circle CCTP V2
 *
 * Kedua arah menggunakan executeBridge(src, dst) yang IDENTIK.
 * Perbedaan hanya di CHAIN_CONFIG — tidak ada if/else per arah.
 */
'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import {
  createPublicClient, createWalletClient, custom, http, fallback,
  parseUnits, formatUnits, erc20Abi, keccak256, type Hex,
} from 'viem'
import { sepolia } from 'viem/chains'
import {
  ARC_CHAIN_ID, ARC_CHAIN_ID_HEX, ARC_RPC, ARC_RPC_BACKUP, ARC_RPC_BACKUP2, ARC_EXPLORER,
  ARC_USDC, ARC_TOKEN_MESSENGER, ARC_MESSAGE_TRANSMITTER, ARC_CCTP_DOMAIN,
  SEPOLIA_CHAIN_ID_HEX, SEPOLIA_RPC, SEPOLIA_RPC_BACKUP, SEPOLIA_RPC_FALLBACK3,
  SEPOLIA_USDC, SEPOLIA_TOKEN_MESSENGER, SEPOLIA_MESSAGE_TRANSMITTER, SEPOLIA_CCTP_DOMAIN,
  CCTP_FAST_FINALITY, CCTP_MAX_FEE, arcTestnet,
} from '@/lib/arcChain'
import { useWallet } from './WalletButton'
import { addTx, updateTx, estimateBridgeReceived } from '@/lib/txHistory'
import { getEvmProvider, NO_WALLET_MSG } from '@/lib/evmProvider'
import { useBridge, STATUS_MESSAGES } from '@/hooks/useBridge'

/* ── Chain Config ─────────────────────────────────────────────────────── */
// Semua perbedaan antar chain ada di sini — executeBridge tidak perlu tahu arah
interface ChainConfig {
  key: 'ARC' | 'SEPOLIA'
  chainId: number
  chainIdHex: string
  name: string
  rpcUrls: string[]
  usdc: `0x${string}`
  tokenMessenger: `0x${string}`
  msgTransmitter: `0x${string}`
  domain: number
  explorer: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  viemChain: any
  // Arc RPC butuh manual receipt polling (waitForTransactionReceipt tidak reliable)
  useManualReceiptPoll: boolean
}

const CHAIN_CONFIG: Record<'ARC' | 'SEPOLIA', ChainConfig> = {
  ARC: {
    key: 'ARC',
    chainId: ARC_CHAIN_ID,
    chainIdHex: ARC_CHAIN_ID_HEX,
    name: 'Arc Testnet',
    rpcUrls: [ARC_RPC, ARC_RPC_BACKUP, ARC_RPC_BACKUP2],
    usdc: ARC_USDC,
    tokenMessenger: ARC_TOKEN_MESSENGER,
    msgTransmitter: ARC_MESSAGE_TRANSMITTER,
    domain: ARC_CCTP_DOMAIN,
    explorer: ARC_EXPLORER,
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
    viemChain: arcTestnet,
    useManualReceiptPoll: true,
  },
  SEPOLIA: {
    key: 'SEPOLIA',
    chainId: 11155111,
    chainIdHex: SEPOLIA_CHAIN_ID_HEX,
    name: 'Ethereum Sepolia',
    rpcUrls: [SEPOLIA_RPC, SEPOLIA_RPC_BACKUP, SEPOLIA_RPC_FALLBACK3],
    usdc: SEPOLIA_USDC,
    tokenMessenger: SEPOLIA_TOKEN_MESSENGER,
    msgTransmitter: SEPOLIA_MESSAGE_TRANSMITTER,
    domain: SEPOLIA_CCTP_DOMAIN,
    explorer: 'https://sepolia.etherscan.io',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    viemChain: sepolia,
    useManualReceiptPoll: false,
  },
}

/* ── ABIs ─────────────────────────────────────────────────────────────── */
const TOKEN_MESSENGER_ABI = [
  {
    type: 'function', name: 'depositForBurn', stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount',               type: 'uint256' },
      { name: 'destinationDomain',    type: 'uint32'  },
      { name: 'mintRecipient',        type: 'bytes32' },
      { name: 'burnToken',            type: 'address' },
      { name: 'destinationCaller',    type: 'bytes32' },
      { name: 'maxFee',               type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32'  },
    ],
    outputs: [{ name: 'nonce', type: 'uint64' }],
  },
] as const

const MESSAGE_TRANSMITTER_ABI = [
  {
    type: 'function', name: 'receiveMessage', stateMutability: 'nonpayable',
    inputs: [{ name: 'message', type: 'bytes' }, { name: 'attestation', type: 'bytes' }],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const

/* ── Helpers ──────────────────────────────────────────────────────────── */
const MESSAGE_SENT_TOPIC = '0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036' as const
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex

function addrToBytes32(addr: string): Hex {
  return `0x${addr.replace(/^0x/, '').toLowerCase().padStart(64, '0')}` as Hex
}
function maskTx(h: string) { return h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '' }
function pendingMintKey(address: string) { return `cctp_pending_mint_${address.toLowerCase()}` }

/** Buat viem public client untuk chain tertentu */
function makePublicClient(cfg: ChainConfig) {
  return createPublicClient({
    chain: cfg.viemChain as any,
    transport: fallback(cfg.rpcUrls.map(u => http(u))),
  }) as any
}

/** Extract messageBytes dari event log MessageSent */
function extractMessageBytes(logs: any[]): Hex | null {
  for (const log of logs) {
    if (log.topics?.[0]?.toLowerCase() === MESSAGE_SENT_TOPIC) {
      const data: string = log.data
      if (!data || data === '0x') continue
      try {
        const hex = data.startsWith('0x') ? data.slice(2) : data
        const byteLength = parseInt(hex.slice(64, 128), 16)
        const payload = hex.slice(128, 128 + byteLength * 2)
        if (payload.length === byteLength * 2) return `0x${payload}` as Hex
      } catch { /* skip */ }
    }
  }
  return null
}

/** Fallback: ambil messageBytes langsung dari RPC jika tidak ada di receipt */
async function fetchMsgBytesFromRpc(rpcUrl: string, txHash: string, blockNumber: number): Promise<Hex | null> {
  const blockHex = `0x${blockNumber.toString(16)}`
  for (const [id, body] of [
    [1, { method: 'eth_getLogs', params: [{ fromBlock: blockHex, toBlock: blockHex, topics: [MESSAGE_SENT_TOPIC] }] }],
    [2, { method: 'eth_getTransactionReceipt', params: [txHash] }],
    [3, { method: 'eth_getLogs', params: [{ fromBlock: `0x${Math.max(0, blockNumber - 5).toString(16)}`, toBlock: `0x${(blockNumber + 2).toString(16)}`, topics: [MESSAGE_SENT_TOPIC] }] }],
  ] as const) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, ...body }),
      })
      const result = (await res.json())?.result
      const logs: any[] = id === 2 ? (result?.logs ?? []) : (result ?? [])
      const txLogs = logs.filter((l: any) => l.transactionHash?.toLowerCase() === txHash.toLowerCase())
      const r = extractMessageBytes(txLogs) ?? extractMessageBytes(logs)
      if (r) return r
    } catch { /* try next */ }
  }
  return null
}

/**
 * Tunggu receipt dengan manual polling — dipakai untuk Arc RPC
 * yang tidak reliable dengan waitForTransactionReceipt
 */
async function waitReceiptManual(publicClient: any, txHash: Hex, intervalMs = 2_000, maxAttempts = 90): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
      if (receipt?.status === 'success') return receipt
      if (receipt?.status === 'reverted') throw new Error(`Tx reverted: ${txHash}`)
    } catch (e: any) {
      if (e?.message?.includes('reverted')) throw e
    }
  }
  throw new Error(`Tx tidak terkonfirmasi setelah ${Math.round(maxAttempts * intervalMs / 1000)}s`)
}

/** Poll attestation via server proxy — exponential backoff 5s→30s */
async function pollAttestation(
  sourceDomain: number,
  burnTxHash: string,
  messageHash: string,
  onProgress: (msg: string) => void,
  maxPolls = 720,
): Promise<string | null> {
  const BASE = 5_000, MAX = 30_000
  for (let i = 1; i <= maxPolls; i++) {
    await new Promise(r => setTimeout(r, Math.min(BASE * Math.pow(1.3, Math.min(i - 1, 10)), MAX)))
    if (i % 4 === 1) {
      const elapsed = Math.floor(i * 10 / 60)
      onProgress(`Menunggu attestation… ~${elapsed}m berlalu (bisa 3–20 menit di testnet)`)
    }
    try {
      const params = new URLSearchParams({
        messageHash, sourceDomain: String(sourceDomain), txHash: burnTxHash,
      })
      const r = await fetch(`/api/bridge/attestation?${params}`, { cache: 'no-store' })
      if (!r.ok) continue
      const data = await r.json()
      if (data.ok && data.status === 'complete' && data.attestation) return data.attestation as string
    } catch { /* retry */ }
  }
  return null
}

/* ── Types ────────────────────────────────────────────────────────────── */
type ChainKey = 'ARC' | 'SEPOLIA'
type BridgeStep = 'idle' | 'approve' | 'burn' | 'attestation' | 'mint' | 'done' | 'error'

/* ── Sub-components ───────────────────────────────────────────────────── */
function StepRow({ num, label, status, detail }: {
  num: number; label: string
  status: 'idle' | 'active' | 'done' | 'error'; detail?: string
}) {
  const icon = status === 'done' ? '✅' : status === 'active' ? '⏳' : status === 'error' ? '❌' : '○'
  const cls  = status === 'done' ? 'text-emerald-400' : status === 'active' ? 'text-amber-300' : status === 'error' ? 'text-red-400' : 'text-zinc-600'
  return (
    <div className={`flex items-start gap-3 py-1.5 ${cls}`}>
      <span className="w-5 text-center shrink-0 text-sm">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm">{num}. {label}</div>
        {detail && <div className="text-xs opacity-60 mt-0.5 break-all font-mono">{detail}</div>}
      </div>
    </div>
  )
}

/* ── Main Component ───────────────────────────────────────────────────── */
export default function BridgePanel() {
  const { address } = useWallet()
  const { state: bridgeState, update: updateBridge, mintWithFallback } = useBridge()

  // srcKey/dstKey menggantikan direction string — hanya ini yang berubah saat toggle
  const [srcKey, setSrcKey]   = useState<ChainKey>('SEPOLIA')
  const [dstKey, setDstKey]   = useState<ChainKey>('ARC')
  const [amount,    setAmount]    = useState('1')
  const [recipient, setRecipient] = useState('')
  const [step,      setStep]      = useState<BridgeStep>('idle')
  const [txs,       setTxs]       = useState({ approve: '', burn: '', mint: '' })
  const [msgHash,   setMsgHash]   = useState('')
  const [progress,  setProgress]  = useState('')
  const [balances,  setBalances]  = useState({ sepolia: '—', arc: '—' })
  const txIdRef  = React.useRef<string | null>(null)
  const addrRef  = React.useRef<string | null>(null)
  const abortRef = React.useRef<boolean>(false)

  const src = CHAIN_CONFIG[srcKey]
  const dst = CHAIN_CONFIG[dstKey]

  /* ── Toggle direction ─────────────────────────────────────────────── */
  function setDirection(newSrc: ChainKey, newDst: ChainKey) {
    if (isBusy) return
    setSrcKey(newSrc)
    setDstKey(newDst)
    setStep('idle')
    setTxs({ approve: '', burn: '', mint: '' })
    setMsgHash(''); setProgress('')
  }

  /* ── Balances ─────────────────────────────────────────────────────── */
  const fetchBalances = useCallback(async () => {
    if (!address) return
    try {
      const sepClient = makePublicClient(CHAIN_CONFIG.SEPOLIA)
      const arcClient = makePublicClient(CHAIN_CONFIG.ARC)
      const [sepBal, arcBal] = await Promise.all([
        sepClient.readContract({ address: SEPOLIA_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] }),
        arcClient.readContract({ address: ARC_USDC,    abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] }),
      ])
      setBalances({
        sepolia: parseFloat(formatUnits(sepBal as bigint, 6)).toFixed(4),
        arc:     parseFloat(formatUnits(arcBal as bigint, 6)).toFixed(4),
      })
    } catch { /* ignore */ }
  }, [address])

  useEffect(() => { fetchBalances() }, [fetchBalances])
  useEffect(() => { const t = setInterval(fetchBalances, 30_000); return () => clearInterval(t) }, [fetchBalances])

  const currentEstimate = useMemo(() => estimateBridgeReceived(amount), [amount])
  const isBusy = step !== 'idle' && step !== 'done' && step !== 'error'

  useEffect(() => { if (!address && isBusy) abortRef.current = true }, [address, isBusy])

  function getStepStatus(s: BridgeStep): 'idle' | 'active' | 'done' | 'error' {
    const order: BridgeStep[] = ['approve', 'burn', 'attestation', 'mint', 'done']
    const cur = order.indexOf(step), tgt = order.indexOf(s)
    if (step === 'error') return tgt <= cur ? 'error' : 'idle'
    if (cur > tgt) return 'done'
    if (cur === tgt) return 'active'
    return 'idle'
  }

  /* ── switchChain ──────────────────────────────────────────────────── */
  async function switchChain(cfg: ChainConfig) {
    const eth = getEvmProvider()
    if (!eth) throw new Error(NO_WALLET_MSG)

    // Untuk Arc: selalu wallet_addEthereumChain dulu agar override nama chain yang salah
    if (cfg.key === 'ARC') {
      try {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: cfg.chainIdHex,
            chainName: cfg.name,
            rpcUrls: [cfg.rpcUrls[0]],
            nativeCurrency: cfg.nativeCurrency,
            blockExplorerUrls: [cfg.explorer],
          }],
        })
        return
      } catch (e: any) {
        if (e?.code === 4001) throw e // user rejected
        // Chain sudah ada → fallthrough ke switchEthereumChain
      }
    }

    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.chainIdHex }] })
  }

  /* ── executeBridge — IDENTIK untuk kedua arah ─────────────────────── */
  async function executeBridge(
    srcCfg: ChainConfig,
    dstCfg: ChainConfig,
    amountStr: string,
    dest: `0x${string}`,
    currentAddress: string,
    txRecordId: string,
  ) {
    const eth = getEvmProvider()
    if (!eth) throw new Error(NO_WALLET_MSG)

    const amountUnits = parseUnits(amountStr, 6) // selalu 6 decimals USDC
    const srcPublic   = makePublicClient(srcCfg)
    const srcWallet   = createWalletClient({
      chain: srcCfg.viemChain as any,
      transport: custom(eth),
      account: currentAddress as `0x${string}`,
    })

    // ── Step 1: Switch ke source chain ──────────────────────────────
    await switchChain(srcCfg)

    // ── Step 2: Approve ─────────────────────────────────────────────
    setStep('approve')
    const allowance = await srcPublic.readContract({
      address: srcCfg.usdc, abi: erc20Abi, functionName: 'allowance',
      args: [currentAddress as `0x${string}`, srcCfg.tokenMessenger],
    }) as bigint

    if (allowance < amountUnits) {
      const approveHash = await (srcWallet as any).writeContract({
        address: srcCfg.usdc, abi: erc20Abi, functionName: 'approve',
        args: [srcCfg.tokenMessenger, amountUnits],
        account: currentAddress as `0x${string}`,
      })
      setTxs(t => ({ ...t, approve: approveHash }))

      if (srcCfg.useManualReceiptPoll) {
        await waitReceiptManual(srcPublic, approveHash)
      } else {
        await srcPublic.waitForTransactionReceipt({
          hash: approveHash, confirmations: 1, timeout: 180_000, pollingInterval: 3_000,
        })
      }
    } else {
      setTxs(t => ({ ...t, approve: 'skipped' }))
    }

    // ── Step 3: Burn (depositForBurn) ────────────────────────────────
    setStep('burn')
    const burnHash = await (srcWallet as any).writeContract({
      address: srcCfg.tokenMessenger,
      abi: TOKEN_MESSENGER_ABI,
      functionName: 'depositForBurn',
      args: [
        amountUnits,
        dstCfg.domain,          // destinationDomain ← satu-satunya yang beda tiap arah
        addrToBytes32(dest),    // mintRecipient bytes32
        srcCfg.usdc,            // burnToken = USDC di source chain
        ZERO_BYTES32,           // destinationCaller = 0 (siapapun bisa relay)
        CCTP_MAX_FEE,           // maxFee
        CCTP_FAST_FINALITY,     // minFinalityThreshold
      ],
      account: currentAddress as `0x${string}`,
    })
    setTxs(t => ({ ...t, burn: burnHash }))
    updateTx(txRecordId, { burnTx: burnHash, status: 'attestation' }, currentAddress)

    if (srcCfg.useManualReceiptPoll) {
      setProgress(`Menunggu konfirmasi burn di ${srcCfg.name}...`)
    }

    const burnReceipt = srcCfg.useManualReceiptPoll
      ? await waitReceiptManual(srcPublic, burnHash, 3_000, 60)
      : await srcPublic.waitForTransactionReceipt({
          hash: burnHash, confirmations: 1, timeout: 180_000, pollingInterval: 3_000,
        })

    // Ambil messageBytes dari receipt atau fallback ke RPC
    let msgBytes = extractMessageBytes(burnReceipt.logs)
    if (!msgBytes) msgBytes = await fetchMsgBytesFromRpc(srcCfg.rpcUrls[0], burnHash, Number(burnReceipt.blockNumber))
    if (!msgBytes && srcCfg.rpcUrls[1]) msgBytes = await fetchMsgBytesFromRpc(srcCfg.rpcUrls[1], burnHash, Number(burnReceipt.blockNumber))
    if (!msgBytes) throw new Error('MessageSent event tidak ditemukan di receipt')

    const msgHashHex = keccak256(msgBytes)
    setMsgHash(msgHashHex)

    // ── Step 4: Attestation (tidak ada popup wallet) ─────────────────
    setStep('attestation')
    if (abortRef.current) throw new Error('Bridge dibatalkan (wallet disconnect)')

    const att = await pollAttestation(srcCfg.domain, burnHash, msgHashHex, setProgress)
    if (!att) throw new Error('Attestation timeout (60 menit). USDC sudah di-burn — coba mint manual nanti.')

    if (abortRef.current) throw new Error('Bridge dibatalkan (wallet disconnect)')

    // ── Step 5: Mint di destination chain ────────────────────────────
    setStep('mint')
    setProgress(`Minting USDC di ${dstCfg.name}...`)
    updateBridge({ status: 'minting', progress: 75 })

    const direction = srcCfg.key === 'SEPOLIA' ? 'sepolia-to-arc' : 'arc-to-sepolia'
    const mintResult = await mintWithFallback({
      amount: amountStr,
      direction,
      recipient: dest !== (currentAddress as `0x${string}`) ? dest : undefined,
      msgBytes,
      att,
    })

    if (!mintResult.ok) {
      // Simpan untuk retry manual
      try {
        localStorage.setItem(pendingMintKey(currentAddress), JSON.stringify({
          msgBytes, att, burnTxHash: burnHash,
          timestamp: Date.now(), direction,
        }))
      } catch { /* ignore */ }
      throw new Error(mintResult.error || `Mint gagal di ${dstCfg.name}`)
    }

    const mintHash = mintResult.mintTxHash ?? null
    if (mintHash) {
      setTxs(t => ({ ...t, mint: mintHash }))
      localStorage.removeItem(pendingMintKey(currentAddress))
    }
    updateTx(txRecordId, { mintTx: mintHash ?? '', status: 'success' }, currentAddress)
    setStep('done')
    fetchBalances()
  }

  /* ── bridge() — entry point dari tombol ──────────────────────────── */
  async function bridge() {
    const eth = getEvmProvider()
    if (!eth) { alert(NO_WALLET_MSG); return }

    let currentAddress = address
    if (!currentAddress) {
      try {
        const accs: string[] = await eth.request({ method: 'eth_requestAccounts' })
        currentAddress = accs?.[0] ?? null
        if (!currentAddress) return
      } catch { return }
    }

    const amt = parseFloat(amount)
    if (!amount || isNaN(amt) || amt <= 0.001) {
      alert('Jumlah minimum bridge adalah 0.002 USDC')
      return
    }

    const dest = (recipient.trim() || currentAddress) as `0x${string}`
    if (!/^0x[a-fA-F0-9]{40}$/.test(dest)) return

    const est = estimateBridgeReceived(amount)
    setTxs({ approve: '', burn: '', mint: '' })
    setMsgHash(''); setProgress('')
    setStep('approve')
    abortRef.current = false

    const txRecord = addTx({
      type: 'bridge', status: 'pending',
      direction: srcKey === 'SEPOLIA' ? 'sepolia-to-arc' : 'arc-to-sepolia',
      fromChain: src.name, toChain: dst.name,
      amountSent: amount, amountReceived: est.received, fee: est.fee,
      wallet: currentAddress,
    })
    txIdRef.current = txRecord.id
    addrRef.current  = currentAddress

    try {
      await executeBridge(src, dst, amount, dest, currentAddress, txRecord.id)
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Bridge gagal'
      if (txIdRef.current && addrRef.current) {
        updateTx(txIdRef.current, { status: 'failed', errorMsg: msg }, addrRef.current)
      }
      setProgress(msg)
      setStep('error')
    }
  }

  /* ── Retry mint manual ────────────────────────────────────────────── */
  async function retryMint() {
    if (!address) return
    try {
      const raw = localStorage.getItem(pendingMintKey(address))
      if (!raw) { alert('Tidak ada data mint yang tersimpan.'); return }
      const { msgBytes, att, direction } = JSON.parse(raw)
      setStep('mint')
      const mintResult = await mintWithFallback({ amount, direction, msgBytes, att })
      if (mintResult.ok) {
        const mintHash = mintResult.mintTxHash ?? null
        if (mintHash) setTxs(t => ({ ...t, mint: mintHash }))
        localStorage.removeItem(pendingMintKey(address))
        setStep('done')
        fetchBalances()
      } else {
        setProgress(mintResult.error || 'Retry gagal')
        setStep('error')
      }
    } catch (e: any) {
      setProgress(e?.shortMessage || e?.message || 'Retry gagal')
      setStep('error')
    }
  }

  /* ── Render ───────────────────────────────────────────────────────── */
  const dstExplorer = dst.explorer

  return (
    <div className="space-y-5">

      {/* Direction toggle */}
      <div className="flex items-center gap-2">
        <button type="button"
          onClick={() => setDirection('SEPOLIA', 'ARC')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
            srcKey === 'SEPOLIA'
              ? 'border-emerald-700 bg-emerald-500/10 text-emerald-300'
              : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
          }`}>
          Sepolia → Arc
        </button>
        <button type="button"
          onClick={() => setDirection('ARC', 'SEPOLIA')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
            srcKey === 'ARC'
              ? 'border-sky-700 bg-sky-500/10 text-sky-300'
              : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
          }`}>
          Arc → Sepolia
        </button>
      </div>

      {/* Balances */}
      {address && (
        <div className="flex items-center justify-between px-1 text-xs text-zinc-600">
          <span>Sepolia USDC: <span className="text-zinc-400">{balances.sepolia}</span></span>
          <span>Arc USDC: <span className="text-zinc-400">{balances.arc}</span></span>
        </div>
      )}

      {/* Amount */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Jumlah USDC ({src.name})</label>
        <input type="number" min="0.01" step="0.01" value={amount}
          onChange={e => setAmount(e.target.value)} disabled={isBusy} placeholder="1"
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600 disabled:opacity-50" />
      </div>

      {/* Fee estimate */}
      {parseFloat(amount) > 0 && (
        <div className="px-3 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/20 space-y-1.5 text-xs">
          <div className="flex justify-between text-zinc-500">
            <span>Kamu kirim</span>
            <span className="text-zinc-300 font-medium">{amount} USDC</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>CCTP fee (estimasi)</span>
            <span className="text-red-400">− {currentEstimate.fee} USDC</span>
          </div>
          <div className="border-t border-zinc-800 pt-1.5 flex justify-between">
            <span className="text-zinc-400">Kamu terima (estimasi)</span>
            <span className="text-emerald-400 font-semibold">{currentEstimate.received} USDC</span>
          </div>
        </div>
      )}

      {/* Recipient */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">
          Recipient di {dst.name} <span className="text-zinc-700">(kosong = wallet kamu)</span>
        </label>
        <input type="text" value={recipient} onChange={e => setRecipient(e.target.value)} disabled={isBusy}
          placeholder="0x… (opsional)"
          className="w-full px-3 py-2.5 rounded-xl border border-zinc-800 bg-black/30 text-sm outline-none focus:border-zinc-600 disabled:opacity-50" />
      </div>

      {/* Bridge button */}
      <button type="button" onClick={bridge} disabled={isBusy || !address}
        className="w-full py-3 rounded-xl border border-emerald-800 bg-emerald-500/10 hover:bg-emerald-500/15 hover:shadow-lg hover:shadow-emerald-500/30 text-sm font-semibold disabled:opacity-50 transition-all">
        {isBusy ? 'Bridging…' : step === 'done' ? '✅ Bridge Selesai' : `Bridge ${amount || '?'} USDC →`}
      </button>

      {!address && <p className="text-center text-xs text-zinc-600">Connect wallet untuk bridge</p>}

      {/* Progress bar */}
      {bridgeState.status !== 'idle' && bridgeState.progress > 0 && (
        <div className="space-y-1.5">
          <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                bridgeState.status === 'success' ? 'bg-emerald-500' :
                bridgeState.status === 'error'   ? 'bg-red-500' : 'bg-sky-500'
              }`}
              style={{ width: `${bridgeState.progress}%` }}
            />
          </div>
          <p className={`text-xs ${
            bridgeState.status === 'success' ? 'text-emerald-400' :
            bridgeState.status === 'error'   ? 'text-red-400' : 'text-zinc-500'
          }`}>{STATUS_MESSAGES[bridgeState.status]}</p>
        </div>
      )}

      {/* Step tracker */}
      {step !== 'idle' && (
        <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30 space-y-0.5">
          <StepRow num={1} label="Approve USDC"
            status={getStepStatus('approve')}
            detail={txs.approve === 'skipped' ? '(sudah disetujui)' : txs.approve ? maskTx(txs.approve) : undefined} />
          <StepRow num={2} label={`Burn di ${src.name}`}
            status={getStepStatus('burn')}
            detail={txs.burn ? maskTx(txs.burn) : undefined} />
          <StepRow num={3} label="Attestation (Circle Iris)"
            status={getStepStatus('attestation')}
            detail={msgHash ? maskTx(msgHash) : undefined} />
          <StepRow num={4} label={`Mint di ${dst.name}`}
            status={getStepStatus('mint')}
            detail={txs.mint ? maskTx(txs.mint) : undefined} />

          {step === 'done' && txs.mint && (
            <a href={`${dstExplorer}/tx/${txs.mint}`} target="_blank" rel="noreferrer"
              className="block mt-2 text-xs text-emerald-400 underline hover:text-emerald-300">
              Lihat di explorer →
            </a>
          )}
          {step === 'attestation' && progress && (
            <p className="text-xs text-amber-400 mt-1">⏳ {progress}</p>
          )}
          {step === 'error' && progress && (
            <p className="text-xs text-red-400 mt-1 break-all">❌ {progress}</p>
          )}
          {step === 'error' && (
            <button type="button" onClick={retryMint}
              className="mt-2 w-full py-2 rounded-lg border border-sky-800 bg-sky-500/10 hover:bg-sky-500/15 text-xs font-medium text-sky-300 transition-colors">
              🔄 Coba Mint Ulang di {dst.name}
            </button>
          )}
        </div>
      )}

      {/* Info */}
      <div className="text-xs text-zinc-700 space-y-0.5 pt-1">
        <p>• Attestation Circle Iris bisa memakan waktu <b className="text-zinc-600">3–20 menit</b> (normal)</p>
        <p>• Arc Testnet otomatis ditambahkan ke wallet jika belum ada</p>
        <p>• CCTP fee: <b className="text-zinc-600">0.001 USDC</b> — minimum bridge 0.002 USDC</p>
        <p>• Butuh USDC Sepolia: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="underline hover:text-zinc-500">faucet.circle.com</a></p>
        <p>• Butuh ETH Sepolia untuk gas approve &amp; burn</p>
      </div>
    </div>
  )
}
