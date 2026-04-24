/**
 * components/BridgePanel.tsx
 * Bridge USDC: Ethereum Sepolia ↔ Arc Testnet via Circle CCTP V2
 * Kedua arah aktif — auto-add Arc Testnet ke wallet jika belum ada
 */
'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import {
  createPublicClient, createWalletClient, custom, http, fallback,
  parseUnits, formatUnits, erc20Abi, keccak256, type Hex,
} from 'viem'
import { sepolia } from 'viem/chains'
import {
  ARC_CHAIN_ID_HEX, ARC_RPC, ARC_RPC_BACKUP, ARC_RPC_BACKUP2, ARC_EXPLORER,
  ARC_USDC, ARC_TOKEN_MESSENGER, ARC_CCTP_DOMAIN,
  SEPOLIA_CHAIN_ID_HEX, SEPOLIA_RPC, SEPOLIA_RPC_BACKUP, SEPOLIA_RPC_FALLBACK3,
  SEPOLIA_USDC, SEPOLIA_TOKEN_MESSENGER, SEPOLIA_MESSAGE_TRANSMITTER, SEPOLIA_CCTP_DOMAIN,
  SEPOLIA_FAST_FINALITY, arcTestnet,
} from '@/lib/arcChain'
import { useWallet } from './WalletButton'
import { addTx, updateTx, estimateBridgeReceived } from '@/lib/txHistory'
import { getEvmProvider, NO_WALLET_MSG } from '@/lib/evmProvider'
import { useBridge, STATUS_MESSAGES } from '@/hooks/useBridge'

/* ── Chain params ─────────────────────────────────────────────────────── */
const ARC_CHAIN_PARAMS = {
  chainId: ARC_CHAIN_ID_HEX,
  chainName: 'Arc Testnet',
  // wallet_addEthereumChain requires decimals: 18 (EIP-3085 spec)
  // Actual USDC decimals (6) are used in all contract calls
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: [ARC_RPC],
  blockExplorerUrls: [ARC_EXPLORER],
}

/** Buat Sepolia public client dengan fallback otomatis ke RPC lain */
function makeSepoliaPublicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: fallback([
      http(SEPOLIA_RPC),
      http(SEPOLIA_RPC_BACKUP),
      http(SEPOLIA_RPC_FALLBACK3),
    ]),
  })
}

/** Buat Arc public client dengan fallback otomatis ke RPC lain */
function makeArcPublicClient() {
  return createPublicClient({
    chain: arcTestnet as any,
    transport: fallback([
      http(ARC_RPC),
      http(ARC_RPC_BACKUP),
      http(ARC_RPC_BACKUP2),
    ]),
  }) as any
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

function addrToBytes32(addr: string): Hex {
  return `0x${addr.replace(/^0x/, '').toLowerCase().padStart(64, '0')}` as Hex
}
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
function maskTx(h: string) { return h ? `${h.slice(0, 10)}…${h.slice(-8)}` : '' }

/** Wallet-scoped pending mint key */
function pendingMintKey(address: string): string {
  return `cctp_pending_mint_${address.toLowerCase()}`
}

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

async function fetchMsgBytesFromRpc(rpcUrl: string, txHash: string, blockNumber: number): Promise<Hex | null> {
  const blockHex = `0x${blockNumber.toString(16)}`
  // Strategy 1: exact block
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs',
        params: [{ fromBlock: blockHex, toBlock: blockHex, topics: [MESSAGE_SENT_TOPIC] }] }),
    })
    const logs: any[] = (await res.json())?.result ?? []
    const txLogs = logs.filter(l => l.transactionHash?.toLowerCase() === txHash.toLowerCase())
    const r = extractMessageBytes(txLogs) ?? extractMessageBytes(logs)
    if (r) return r
  } catch { /* try next */ }
  // Strategy 2: receipt re-fetch
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_getTransactionReceipt', params: [txHash] }),
    })
    const logs: any[] = (await res.json())?.result?.logs ?? []
    const r = extractMessageBytes(logs)
    if (r) return r
  } catch { /* try next */ }
  // Strategy 3: range ±5 blocks
  try {
    const fromHex = `0x${Math.max(0, blockNumber - 5).toString(16)}`
    const toHex   = `0x${(blockNumber + 2).toString(16)}`
    const res = await fetch(rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_getLogs',
        params: [{ fromBlock: fromHex, toBlock: toHex, topics: [MESSAGE_SENT_TOPIC] }] }),
    })
    const logs: any[] = (await res.json())?.result ?? []
    const txLogs = logs.filter(l => l.transactionHash?.toLowerCase() === txHash.toLowerCase())
    return extractMessageBytes(txLogs) ?? extractMessageBytes(logs)
  } catch { /* give up */ }
  return null
}

/**
 * pollAttestation — FIX BUG #2: gunakan server proxy /api/bridge/attestation
 * BUKAN fetch langsung ke Iris (CORS blocked di browser)
 */
async function pollAttestation(
  sourceDomainId: number,
  burnTxHash: string,
  messageHash: string,
  onProgress: (msg: string) => void,
  maxPolls = 720  // 720 × 5s = 60 menit (1 jam)
): Promise<string | null> {
  for (let i = 1; i <= maxPolls; i++) {
    await new Promise(r => setTimeout(r, 5000))
    if (i % 6 === 1) {
      const elapsed = Math.floor(i * 5 / 60)
      onProgress(`Menunggu attestation… ${elapsed}m berlalu (bisa sampai 60 menit di testnet)`)
    }
    try {
      // ✅ Server proxy — bypass CORS, retry built-in
      const params = new URLSearchParams({
        messageHash,
        sourceDomain: String(sourceDomainId),
        txHash: burnTxHash,
      })
      const r = await fetch(`/api/bridge/attestation?${params}`)
      if (!r.ok) continue
      const data = await r.json()
      if (data.ok && data.attestation && data.status === 'complete') {
        return data.attestation as string
      }
      // data.status === 'pending' → lanjut polling
    } catch { /* network error → retry */ }
  }
  return null
}

/* ── Types ────────────────────────────────────────────────────────────── */
type Direction = 'sepolia-to-arc' | 'arc-to-sepolia'
type BridgeStep = 'idle' | 'approve' | 'burn' | 'attestation' | 'mint' | 'done' | 'error'

function RetryMintButton({ onRetry }: { sepPublicClient: any; currentAddress: string | null; onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = React.useState(false)
  return (
    <button
      type="button"
      disabled={retrying}
      onClick={async () => { setRetrying(true); await onRetry(); setRetrying(false) }}
      className="mt-2 w-full py-2 rounded-lg border border-sky-800 bg-sky-500/10 hover:bg-sky-500/15 text-xs font-medium text-sky-300 disabled:opacity-50 transition-colors"
    >
      {retrying ? '⏳ Mencoba mint ulang…' : '🔄 Coba Mint Ulang di Sepolia'}
    </button>
  )
}

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
  const { state: bridgeState, update: updateBridge, mintWithFallback, reset: resetBridge } = useBridge()
  const [direction, setDirection] = useState<Direction>('sepolia-to-arc')
  const [amount,    setAmount]    = useState('0.10')
  const [recipient, setRecipient] = useState('')
  const [step,      setStep]      = useState<BridgeStep>('idle')
  const [txs,       setTxs]       = useState({ approve: '', burn: '', mint: '' })
  const [msgHash,   setMsgHash]   = useState('')
  const [progress,  setProgress]  = useState('')
  const [balances,  setBalances]  = useState({ sepolia: '—', arc: '—' })
  const txIdRef = React.useRef<string | null>(null)
  const addrRef  = React.useRef<string | null>(null)
  const abortRef = React.useRef<boolean>(false) // abort flag saat disconnect

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    if (!address) return
    try {
      const sepoliaClient = makeSepoliaPublicClient()
      const arcClient = makeArcPublicClient()
      const [sepBal, arcBal] = await Promise.all([
        sepoliaClient.readContract({ address: SEPOLIA_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] }),
        arcClient.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] }),
      ])
      setBalances({
        sepolia: parseFloat(formatUnits(sepBal as bigint, 6)).toFixed(4),
        arc:     parseFloat(formatUnits(arcBal as bigint, 6)).toFixed(4),
      })
    } catch { /* ignore */ }
  }, [address])

  useEffect(() => { fetchBalances() }, [fetchBalances])
  useEffect(() => {
    const t = setInterval(fetchBalances, 30_000)
    return () => clearInterval(t)
  }, [fetchBalances])

  const srcLabel    = direction === 'sepolia-to-arc' ? 'Sepolia' : 'Arc Testnet'
  const dstLabel    = direction === 'sepolia-to-arc' ? 'Arc Testnet' : 'Sepolia'
  const dstExplorer = direction === 'sepolia-to-arc' ? ARC_EXPLORER : 'https://sepolia.etherscan.io'
  const currentEstimate = useMemo(() => estimateBridgeReceived(amount), [amount])
  const isBusy = step !== 'idle' && step !== 'done' && step !== 'error'

  // Abort bridge jika wallet disconnect saat bridging
  useEffect(() => {
    if (!address && isBusy) {
      abortRef.current = true
    }
  }, [address, isBusy])

  function getStepStatus(s: BridgeStep): 'idle' | 'active' | 'done' | 'error' {
    const order: BridgeStep[] = ['approve', 'burn', 'attestation', 'mint', 'done']
    const cur = order.indexOf(step), tgt = order.indexOf(s)
    if (step === 'error') return tgt <= cur ? 'error' : 'idle'
    if (cur > tgt) return 'done'
    if (cur === tgt) return 'active'
    return 'idle'
  }

  /** Switch chain — otomatis add Arc Testnet jika belum ada di wallet */
  async function switchChain(chainIdHex: string, addParams?: object) {
    const eth = getEvmProvider()
    if (!eth) throw new Error(NO_WALLET_MSG)
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
    } catch (e: any) {
      if (e?.code === 4902 && addParams) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [addParams] })
        // Setelah add, switch lagi
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
      } else throw e
    }
  }

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
    if (!amount || isNaN(amt) || amt <= 0) return
    const dest = (recipient.trim() || currentAddress) as `0x${string}`
    if (!/^0x[a-fA-F0-9]{40}$/.test(dest)) return

    const est = estimateBridgeReceived(amount)
    setTxs({ approve: '', burn: '', mint: '' })
    setMsgHash(''); setProgress('')
    setStep('approve')
    abortRef.current = false // reset abort flag

    const txRecord = addTx({
      type: 'bridge', status: 'pending', direction,
      fromChain: direction === 'sepolia-to-arc' ? 'Sepolia' : 'Arc Testnet',
      toChain:   direction === 'sepolia-to-arc' ? 'Arc Testnet' : 'Sepolia',
      amountSent: amount, amountReceived: est.received, fee: est.fee,
      wallet: currentAddress,
    })
    txIdRef.current = txRecord.id
    addrRef.current  = currentAddress

    try {
      if (direction === 'sepolia-to-arc') {
        // ── Sepolia → Arc ──────────────────────────────────────────────
        await switchChain(SEPOLIA_CHAIN_ID_HEX)

        const walletClient = createWalletClient({ chain: sepolia, transport: custom(eth), account: currentAddress as `0x${string}` })
        const publicClient = makeSepoliaPublicClient()
        const amountUnits  = parseUnits(amount, 6)

        // ── Step 1: Approve ──────────────────────────────────────────
        setStep('approve')
        const allowance = await publicClient.readContract({
          address: SEPOLIA_USDC, abi: erc20Abi, functionName: 'allowance',
          args: [currentAddress as `0x${string}`, SEPOLIA_TOKEN_MESSENGER],
        }) as bigint

        if (allowance < amountUnits) {
          const approveHash = await (walletClient as any).writeContract({
            address: SEPOLIA_USDC, abi: erc20Abi, functionName: 'approve',
            args: [SEPOLIA_TOKEN_MESSENGER, amountUnits],
            account: currentAddress as `0x${string}`,
          })
          setTxs(t => ({ ...t, approve: approveHash }))
          // FIX BUG #3: timeout + pollingInterval agar tidak stuck
          await publicClient.waitForTransactionReceipt({
            hash: approveHash, confirmations: 1,
            timeout: 180_000, pollingInterval: 3_000,
          })
        } else {
          setTxs(t => ({ ...t, approve: 'skipped' }))
        }

        // ── Step 2: Burn ─────────────────────────────────────────────
        // FIX BUG #4: setStep('burn') SELALU dipanggil setelah approve
        setStep('burn')
        const burnHash = await (walletClient as any).writeContract({
          address: SEPOLIA_TOKEN_MESSENGER, abi: TOKEN_MESSENGER_ABI, functionName: 'depositForBurn',
          args: [amountUnits, ARC_CCTP_DOMAIN, addrToBytes32(dest), SEPOLIA_USDC, ZERO_BYTES32, 0n, SEPOLIA_FAST_FINALITY],
          account: currentAddress as `0x${string}`,
        })
        setTxs(t => ({ ...t, burn: burnHash }))
        updateTx(txRecord.id, { burnTx: burnHash, status: 'attestation' }, currentAddress)
        const burnReceipt = await publicClient.waitForTransactionReceipt({
          hash: burnHash, confirmations: 1,
          timeout: 180_000, pollingInterval: 3_000,
        })

        let msgBytes = extractMessageBytes(burnReceipt.logs)
        if (!msgBytes) msgBytes = await fetchMsgBytesFromRpc(SEPOLIA_RPC, burnHash, Number(burnReceipt.blockNumber))
        if (!msgBytes) msgBytes = await fetchMsgBytesFromRpc(SEPOLIA_RPC_BACKUP, burnHash, Number(burnReceipt.blockNumber))
        if (!msgBytes) throw new Error('MessageSent event tidak ditemukan di receipt')

        const msgHashHex = keccak256(msgBytes)
        setMsgHash(msgHashHex)
        setStep('attestation')

        if (abortRef.current) throw new Error('Bridge dibatalkan (wallet disconnect)')

        // ── Step 3: Poll attestation via server proxy ─────────────────
        // FIX BUG #2: gunakan server proxy, bukan langsung ke Iris (CORS)
        const att = await pollAttestation(SEPOLIA_CCTP_DOMAIN, burnHash, msgHashHex, setProgress)
        if (!att) throw new Error('Attestation timeout (60 menit). USDC sudah di-burn — coba mint manual nanti.')

        if (abortRef.current) throw new Error('Bridge dibatalkan (wallet disconnect)')

        // ── Step 4: Mint di Arc ───────────────────────────────────────
        setStep('mint')
        setProgress('Minting USDC di Arc Testnet...')
        updateBridge({ status: 'minting', progress: 75 })

        // FIX BUG #1: gunakan return value, bukan bridgeState (stale closure)
        const mintResult = await mintWithFallback({
          amount,
          direction: 'sepolia-to-arc',
          recipient: dest !== currentAddress ? dest : undefined,
          msgBytes,
          att,
        })

        if (mintResult.ok) {
          const mintHash = mintResult.mintTxHash ?? null
          if (mintHash) setTxs(t => ({ ...t, mint: mintHash }))
          updateTx(txRecord.id, { mintTx: mintHash ?? '', status: 'success' }, currentAddress)
          setStep('done')
          fetchBalances()
        } else {
          throw new Error(mintResult.error || 'Mint gagal di Arc')
        }

      } else {
        // ── Arc → Sepolia ──────────────────────────────────────────────
        await switchChain(ARC_CHAIN_ID_HEX, ARC_CHAIN_PARAMS)

        const arcWallet = createWalletClient({ chain: arcTestnet as any, transport: custom(eth), account: currentAddress as `0x${string}` })
        const arcPublic = makeArcPublicClient()
        const amountUnits = parseUnits(amount, 6)

        // ── Step 1: Approve ──────────────────────────────────────────
        setStep('approve')
        const arcAllowance = await arcPublic.readContract({
          address: ARC_USDC, abi: erc20Abi, functionName: 'allowance',
          args: [currentAddress as `0x${string}`, ARC_TOKEN_MESSENGER],
        }) as bigint

        if (arcAllowance < amountUnits) {
          const approveHash = await (arcWallet as any).writeContract({
            address: ARC_USDC, abi: erc20Abi, functionName: 'approve',
            args: [ARC_TOKEN_MESSENGER, amountUnits],
            account: currentAddress as `0x${string}`,
          })
          setTxs(t => ({ ...t, approve: approveHash }))
          // Arc Testnet: timeout 5 menit, polling 2 detik
          await arcPublic.waitForTransactionReceipt({
            hash: approveHash, confirmations: 1,
            timeout: 300_000, pollingInterval: 2_000,
          })
        } else {
          setTxs(t => ({ ...t, approve: 'skipped' }))
        }

        // ── Step 2: Burn ─────────────────────────────────────────────
        setStep('burn')
        const burnHash = await (arcWallet as any).writeContract({
          address: ARC_TOKEN_MESSENGER, abi: TOKEN_MESSENGER_ABI, functionName: 'depositForBurn',
          args: [amountUnits, SEPOLIA_CCTP_DOMAIN, addrToBytes32(dest), ARC_USDC, ZERO_BYTES32, 0n, 1000],
          account: currentAddress as `0x${string}`,
        })
        setTxs(t => ({ ...t, burn: burnHash }))
        updateTx(txRecord.id, { burnTx: burnHash, status: 'attestation' }, currentAddress)
        setProgress('Menunggu konfirmasi burn di Arc Testnet...')

        // Arc Testnet: deterministic finality ~0.5s tapi RPC bisa lambat
        // Retry getTransactionReceipt manual agar tidak timeout
        let burnReceipt: any = null
        for (let attempt = 0; attempt < 60; attempt++) {
          await new Promise(r => setTimeout(r, 3_000))
          try {
            burnReceipt = await arcPublic.getTransactionReceipt({ hash: burnHash })
            if (burnReceipt?.status === 'success') break
            if (burnReceipt?.status === 'reverted') throw new Error('Burn tx reverted di Arc Testnet')
          } catch (e: any) {
            if (e?.message?.includes('reverted')) throw e
            // RPC error → retry
          }
        }
        if (!burnReceipt) throw new Error('Burn tx tidak terkonfirmasi setelah 3 menit. Cek ArcScan untuk status.')

        let msgBytes = extractMessageBytes(burnReceipt.logs)
        if (!msgBytes) msgBytes = await fetchMsgBytesFromRpc(ARC_RPC, burnHash, Number(burnReceipt.blockNumber))
        if (!msgBytes) msgBytes = await fetchMsgBytesFromRpc(ARC_RPC_BACKUP, burnHash, Number(burnReceipt.blockNumber))
        if (!msgBytes) throw new Error('MessageSent event tidak ditemukan di receipt')

        const msgHashHex = keccak256(msgBytes)
        setMsgHash(msgHashHex)
        setStep('attestation')

        if (abortRef.current) throw new Error('Bridge dibatalkan (wallet disconnect)')

        // ── Step 3: Poll attestation via server proxy ─────────────────
        // FIX BUG #2: gunakan server proxy, bukan langsung ke Iris (CORS)
        const att = await pollAttestation(ARC_CCTP_DOMAIN, burnHash, msgHashHex, setProgress)
        if (!att) throw new Error('Attestation timeout (60 menit). USDC sudah di-burn — coba mint manual nanti.')

        if (abortRef.current) throw new Error('Bridge dibatalkan (wallet disconnect)')

        // ── Step 4: Mint di Sepolia ───────────────────────────────────
        setStep('mint')
        setProgress('Minting USDC di Sepolia...')
        updateBridge({ status: 'minting', progress: 75 })

        // FIX BUG #1: gunakan return value, bukan bridgeState (stale closure)
        const mintResult = await mintWithFallback({
          amount,
          direction: 'arc-to-sepolia',
          recipient: dest !== currentAddress ? dest : undefined,
          msgBytes,
          att,
        })

        if (mintResult.ok) {
          const mintHash = mintResult.mintTxHash ?? null
          if (mintHash) {
            setTxs(t => ({ ...t, mint: mintHash }))
            if (address) localStorage.removeItem(pendingMintKey(address))
          }
          updateTx(txRecord.id, { mintTx: mintHash ?? '', status: 'success' }, currentAddress)
          setStep('done')
          fetchBalances()
        } else {
          // Simpan untuk retry
          try {
            if (address) {
              localStorage.setItem(pendingMintKey(address), JSON.stringify({
                msgBytes, att, burnTxHash: burnHash,
                timestamp: Date.now(), direction: 'arc-to-sepolia',
              }))
            }
          } catch { /* ignore */ }
          throw new Error(mintResult.error || 'Mint gagal di Sepolia')
        }
      }
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Bridge gagal'
      if (txIdRef.current && addrRef.current) {
        updateTx(txIdRef.current, { status: 'failed', errorMsg: msg }, addrRef.current)
      }
      setProgress(msg)
      setStep('error')
    }
  }

  return (
    <div className="space-y-5">
      {/* Direction */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setDirection('sepolia-to-arc')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${direction === 'sepolia-to-arc' ? 'border-emerald-700 bg-emerald-500/10 text-emerald-300' : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
          Sepolia → Arc
        </button>
        <button type="button" onClick={() => setDirection('arc-to-sepolia')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${direction === 'arc-to-sepolia' ? 'border-sky-700 bg-sky-500/10 text-sky-300' : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
          Arc → Sepolia
        </button>
      </div>

      {/* Balance display */}
      {address && (
        <div className="flex items-center justify-between px-1 text-xs text-zinc-600">
          <span>Sepolia USDC: <span className="text-zinc-400">{balances.sepolia}</span></span>
          <span>Arc USDC: <span className="text-zinc-400">{balances.arc}</span></span>
        </div>
      )}



      {/* Amount */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Jumlah USDC ({srcLabel})</label>
        <input type="number" min="0.01" step="0.01" value={amount}
          onChange={e => setAmount(e.target.value)} disabled={isBusy} placeholder="0.10"
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
          Recipient di {dstLabel} <span className="text-zinc-700">(kosong = wallet kamu)</span>
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
          <div className="flex items-center justify-between text-xs">
            <span className={
              bridgeState.status === 'success' ? 'text-emerald-400' :
              bridgeState.status === 'error'   ? 'text-red-400' : 'text-zinc-500'
            }>
              {STATUS_MESSAGES[bridgeState.status]}
            </span>
          </div>
        </div>
      )}

      {/* Progress steps */}
      {step !== 'idle' && (
        <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/30 space-y-0.5">
          <StepRow num={1} label="Approve USDC"              status={getStepStatus('approve')}     detail={txs.approve && txs.approve !== 'skipped' ? maskTx(txs.approve) : txs.approve === 'skipped' ? '(sudah disetujui sebelumnya)' : undefined} />
          <StepRow num={2} label={`Burn di ${srcLabel}`}     status={getStepStatus('burn')}        detail={txs.burn ? maskTx(txs.burn) : undefined} />
          <StepRow num={3} label="Attestation (Circle Iris)" status={getStepStatus('attestation')} detail={msgHash ? maskTx(msgHash) : undefined} />
          <StepRow num={4} label={`Mint di ${dstLabel}`}     status={getStepStatus('mint')}        detail={txs.mint ? maskTx(txs.mint) : undefined} />
          {step === 'done' && txs.mint && (
            <a href={`${dstExplorer}/tx/${txs.mint}`} target="_blank" rel="noreferrer"
              className="block mt-2 text-xs text-emerald-400 underline hover:text-emerald-300">
              Lihat di explorer →
            </a>
          )}
          {step === 'done' && !txs.mint && bridgeState.explorerUrl && (
            <a href={bridgeState.explorerUrl} target="_blank" rel="noreferrer"
              className="block mt-2 text-xs text-emerald-400 underline hover:text-emerald-300">
              Lihat di explorer (BridgeKit) →
            </a>
          )}
          {step === 'attestation' && progress && (
            <p className="text-xs text-amber-400 mt-1">⏳ {progress}</p>
          )}
          {step === 'error' && progress && (
            <p className="text-xs text-red-400 mt-1 break-all">❌ {progress}</p>
          )}
          {step === 'error' && direction === 'arc-to-sepolia' && (
            <RetryMintButton
              sepPublicClient={null}
              currentAddress={address}
              onRetry={async () => {
                try {
                  const raw = address ? localStorage.getItem(pendingMintKey(address)) : null
                  if (!raw) { alert('Tidak ada data mint yang tersimpan.'); return }
                  const { msgBytes, att } = JSON.parse(raw)
                  const eth = getEvmProvider()
                  if (!eth) return
                  const sepPublic = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
                  const sepWallet = createWalletClient({ chain: sepolia, transport: custom(eth), account: address as `0x${string}` })
                  setStep('mint')
                  const mintHash = await (sepWallet as any).writeContract({
                    address: SEPOLIA_MESSAGE_TRANSMITTER, abi: MESSAGE_TRANSMITTER_ABI,
                    functionName: 'receiveMessage', args: [msgBytes as Hex, att as Hex],
                    account: address as `0x${string}`,
                  })
                  setTxs(t => ({ ...t, mint: mintHash }))
                  await sepPublic.waitForTransactionReceipt({ hash: mintHash, confirmations: 1 })
                  if (address) localStorage.removeItem(pendingMintKey(address))
                  setStep('done')
                } catch (e: any) {
                  setProgress(e?.shortMessage || e?.message || 'Retry gagal')
                  setStep('error')
                }
              }}
            />
          )}
        </div>
      )}

      {/* Info */}
      <div className="text-xs text-zinc-700 space-y-0.5 pt-1">
        <p>• Attestation Circle Iris bisa memakan waktu <b className="text-zinc-600">3–20 menit</b> (normal)</p>
        <p>• Arc Testnet otomatis ditambahkan ke wallet jika belum ada</p>
        <p>• Butuh USDC Sepolia: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="underline hover:text-zinc-500">faucet.circle.com</a></p>
        <p>• Butuh ETH Sepolia untuk gas approve &amp; burn</p>
      </div>
    </div>
  )
}
