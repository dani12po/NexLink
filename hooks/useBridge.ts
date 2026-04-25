/**
 * hooks/useBridge.ts
 * Manual CCTP V2 — flow IDENTIK untuk kedua arah.
 * Perbedaan hanya di CHAIN_CONFIG, bukan di logika.
 *
 * Pakai ERC-20 approve() standar (bukan Permit2) → kompatibel OKX/semua wallet.
 * Attestation polling dari browser langsung → tidak kena IP block Vercel.
 */
'use client'

import { useState, useCallback } from 'react'
import {
  createWalletClient, createPublicClient, custom, http, fallback,
  parseUnits, erc20Abi, keccak256, type Hex,
} from 'viem'
import { sepolia } from 'viem/chains'
import {
  ARC_CHAIN_ID_HEX, ARC_RPC, ARC_RPC_BACKUP, ARC_RPC_BACKUP2,
  ARC_USDC, ARC_TOKEN_MESSENGER, ARC_CCTP_DOMAIN,
  SEPOLIA_CHAIN_ID_HEX, SEPOLIA_RPC, SEPOLIA_RPC_BACKUP, SEPOLIA_RPC_FALLBACK3,
  SEPOLIA_USDC, SEPOLIA_TOKEN_MESSENGER, SEPOLIA_CCTP_DOMAIN,
  CCTP_FAST_FINALITY, CCTP_MAX_FEE, IRIS_API, arcTestnet,
  ARC_EXPLORER, BRIDGE_KIT_CHAIN_ARC, BRIDGE_KIT_CHAIN_SEPOLIA,
} from '@/lib/arcChain'
import { addTx, updateTx } from '@/lib/txHistory'
import { getEvmProvider } from '@/lib/evmProvider'

// ─── Chain Config ──────────────────────────────────────────────────────────
// Semua perbedaan antar chain ada di sini — flow tidak perlu tahu arah
interface ChainCfg {
  chainIdHex:    string
  viemChain:     any
  rpcUrls:       string[]
  usdc:          `0x${string}`
  tokenMessenger:`0x${string}`
  domain:        number
  explorer:      string
  // Arc butuh manual receipt polling (RPC tidak reliable untuk waitForTransactionReceipt)
  manualPoll:    boolean
  // Gas override — Arc RPC sering return estimasi = 0
  approveGas?:   bigint
  burnGas?:      bigint
  // Cara switch chain di wallet
  addChainParams?: object
}

const CHAIN_CFG: Record<string, ChainCfg> = {
  [BRIDGE_KIT_CHAIN_ARC]: {
    chainIdHex:     ARC_CHAIN_ID_HEX,
    viemChain:      arcTestnet as any,
    rpcUrls:        [ARC_RPC, ARC_RPC_BACKUP, ARC_RPC_BACKUP2],
    usdc:           ARC_USDC,
    tokenMessenger: ARC_TOKEN_MESSENGER,
    domain:         ARC_CCTP_DOMAIN,
    explorer:       ARC_EXPLORER,
    manualPoll:     true,
    approveGas:     100_000n,
    burnGas:        300_000n,
    addChainParams: {
      chainId:     ARC_CHAIN_ID_HEX,
      chainName:   'Arc Testnet',
      rpcUrls:     [ARC_RPC],
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      blockExplorerUrls: [ARC_EXPLORER],
    },
  },
  [BRIDGE_KIT_CHAIN_SEPOLIA]: {
    chainIdHex:     SEPOLIA_CHAIN_ID_HEX,
    viemChain:      sepolia,
    rpcUrls:        [SEPOLIA_RPC, SEPOLIA_RPC_BACKUP, SEPOLIA_RPC_FALLBACK3],
    usdc:           SEPOLIA_USDC,
    tokenMessenger: SEPOLIA_TOKEN_MESSENGER,
    domain:         SEPOLIA_CCTP_DOMAIN,
    explorer:       'https://sepolia.etherscan.io',
    manualPoll:     false,
  },
}

// ─── ABIs ──────────────────────────────────────────────────────────────────
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

// ─── Types ─────────────────────────────────────────────────────────────────
export type BridgeDirection = 'sepolia-to-arc' | 'arc-to-sepolia'

export interface ExecuteBridgeParams {
  fromChain:         string
  toChain:           string
  amount:            string
  walletAddress:     string
  recipientAddress?: string
  onEvent:           (method: string, state: string, txHash?: string, extra?: string) => void
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const MESSAGE_SENT_TOPIC = '0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036'
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex

function addrToBytes32(addr: string): Hex {
  return `0x${addr.replace(/^0x/, '').toLowerCase().padStart(64, '0')}` as Hex
}
function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }

function extractMessageBytes(logs: any[]): Hex | null {
  for (const log of logs) {
    if ((log.topics?.[0] as string)?.toLowerCase() !== MESSAGE_SENT_TOPIC) continue
    const data = log.data as string
    if (!data || data === '0x') continue
    try {
      const hex     = data.startsWith('0x') ? data.slice(2) : data
      const byteLen = parseInt(hex.slice(64, 128), 16)
      const payload = hex.slice(128, 128 + byteLen * 2)
      if (payload.length === byteLen * 2) return `0x${payload}` as Hex
    } catch { /* skip */ }
  }
  return null
}

async function fetchMsgBytesFromRpc(rpcUrl: string, txHash: string, blockNumber: number): Promise<Hex | null> {
  const blockHex = `0x${blockNumber.toString(16)}`
  for (const [id, method, params] of [
    [1, 'eth_getLogs',              [{ fromBlock: blockHex, toBlock: blockHex, topics: [MESSAGE_SENT_TOPIC] }]],
    [2, 'eth_getTransactionReceipt',[txHash]],
    [3, 'eth_getLogs',              [{ fromBlock: `0x${Math.max(0, blockNumber - 5).toString(16)}`, toBlock: `0x${(blockNumber + 2).toString(16)}`, topics: [MESSAGE_SENT_TOPIC] }]],
  ] as const) {
    try {
      const res  = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
      const json = await res.json()
      const logs: any[] = id === 2 ? (json?.result?.logs ?? []) : (json?.result ?? [])
      const txLogs = logs.filter((l: any) => l.transactionHash?.toLowerCase() === txHash.toLowerCase())
      const r = extractMessageBytes(txLogs) ?? extractMessageBytes(logs)
      if (r) return r
    } catch { /* try next */ }
  }
  return null
}

/**
 * Tunggu receipt dengan manual polling.
 * Dipakai untuk chain yang RPC-nya tidak reliable untuk waitForTransactionReceipt.
 */
async function waitReceiptManual(client: any, hash: Hex, intervalMs = 1_500, maxMs = 180_000): Promise<any> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    try {
      const r = await client.getTransactionReceipt({ hash })
      if (r?.status === 'success') return r
      if (r?.status === 'reverted') throw new Error(`Transaksi reverted: ${hash}`)
    } catch (e: any) {
      if (e?.message?.includes('reverted')) throw e
    }
  }
  throw new Error(`Timeout menunggu konfirmasi. Cek explorer untuk status tx: ${hash}`)
}

/**
 * Tunggu receipt — pilih metode berdasarkan config chain.
 * manualPoll=true: manual polling (Arc)
 * manualPoll=false: waitForTransactionReceipt viem (Sepolia)
 */
async function waitReceipt(client: any, hash: Hex, cfg: ChainCfg): Promise<any> {
  if (cfg.manualPoll) {
    return waitReceiptManual(client, hash)
  }
  return client.waitForTransactionReceipt({
    hash, confirmations: 1, timeout: 180_000, pollingInterval: 3_000,
  })
}

/** Poll Iris langsung dari browser — tidak kena IP block */
async function pollIrisDirect(sourceDomain: number, txHash: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${IRIS_API}/v2/messages/${sourceDomain}?transactionHash=${txHash}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) },
    )
    if (!res.ok) return null
    const data = await res.json()
    const msg  = data?.messages?.[0]
    if (msg?.status === 'complete' && msg?.attestation && msg.attestation !== 'PENDING') {
      return msg.attestation as string
    }
  } catch { /* timeout */ }
  return null
}

/** Fallback: poll via server proxy */
async function pollIrisViaProxy(sourceDomain: number, txHash: string, messageHash: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ sourceDomain: String(sourceDomain), txHash, messageHash })
    const res  = await fetch(`/api/bridge/attestation?${params}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    if (data.ok && data.status === 'complete' && data.attestation) return data.attestation as string
  } catch { /* network error */ }
  return null
}

async function pollAttestation(
  sourceDomain: number,
  txHash: string,
  messageHash: string,
  onProgress: (msg: string) => void,
  abortSignal: AbortSignal,
): Promise<string> {
  // Arc finality instan → mulai 2s; Sepolia ~12 blok → mulai 5s
  const BASE  = sourceDomain === ARC_CCTP_DOMAIN ? 2_000 : 5_000
  const MAX   = sourceDomain === ARC_CCTP_DOMAIN ? 15_000 : 30_000
  const LIMIT = 30 * 60 * 1_000
  const start = Date.now()

  for (let i = 0; ; i++) {
    if (abortSignal.aborted) throw new Error('Bridge dibatalkan')
    if (Date.now() - start > LIMIT) throw new Error('Attestation timeout (30 menit). USDC sudah di-burn — coba mint manual nanti.')

    await sleep(Math.min(BASE * Math.pow(1.3, Math.min(i, 10)), MAX))

    const elapsed = Math.floor((Date.now() - start) / 1_000)
    if (i % 3 === 0) onProgress(`Menunggu attestation… ${elapsed}s`)

    const att = await pollIrisDirect(sourceDomain, txHash)
      ?? await pollIrisViaProxy(sourceDomain, txHash, messageHash)
    if (att) return att
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────────
export function useBridge() {
  const [isLoading, setIsLoading] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [result,    setResult]    = useState<{ mintTxHash?: string; explorerUrl?: string } | null>(null)
  const abortCtrl = { current: new AbortController() }

  const executeBridge = useCallback(async (params: ExecuteBridgeParams) => {
    const { fromChain, toChain, amount, walletAddress, recipientAddress, onEvent } = params

    // ── Config — semua perbedaan ada di sini, bukan di logika ─────────
    const src = CHAIN_CFG[fromChain]
    const dst = CHAIN_CFG[toChain]
    if (!src || !dst) throw new Error(`Chain tidak didukung: ${fromChain} → ${toChain}`)

    const dest        = (recipientAddress?.trim() || walletAddress) as `0x${string}`
    const amountUnits = parseUnits(amount, 6)

    const eth = getEvmProvider()
    if (!eth) throw new Error('Wallet tidak terdeteksi')

    abortCtrl.current = new AbortController()
    setIsLoading(true)
    setError(null)
    setResult(null)

    const txRecord = addTx({
      type: 'bridge', status: 'pending',
      direction: fromChain === BRIDGE_KIT_CHAIN_ARC ? 'arc-to-sepolia' : 'sepolia-to-arc',
      fromChain: src.explorer.includes('arcscan') ? 'Arc Testnet' : 'Ethereum Sepolia',
      toChain:   dst.explorer.includes('arcscan') ? 'Arc Testnet' : 'Ethereum Sepolia',
      amountSent: amount, wallet: walletAddress,
    })

    try {
      // ── Setup viem clients ─────────────────────────────────────────
      const srcClient = createPublicClient({
        chain:     src.viemChain,
        transport: fallback(src.rpcUrls.map(u => http(u))),
      }) as any

      const walletClient = createWalletClient({
        chain:     src.viemChain,
        transport: custom(eth),
        account:   walletAddress as `0x${string}`,
      })

      // ── Switch ke source chain ─────────────────────────────────────
      // Jika chain punya addChainParams, pakai wallet_addEthereumChain
      // (override nama chain yang salah di wallet, misal "Core" → "Arc Testnet")
      if (src.addChainParams) {
        try {
          await eth.request({ method: 'wallet_addEthereumChain', params: [src.addChainParams] })
        } catch (e: any) {
          if (e?.code === 4001) throw new Error('User menolak switch chain')
          // Chain sudah ada → fallback ke switchEthereumChain
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: src.chainIdHex }] })
        }
      } else {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: src.chainIdHex }] })
      }

      // ── Step 1: Approve ERC-20 standar ────────────────────────────
      onEvent('approve', 'pending')
      const allowance = await srcClient.readContract({
        address: src.usdc, abi: erc20Abi, functionName: 'allowance',
        args: [walletAddress as `0x${string}`, src.tokenMessenger],
      }) as bigint

      if (allowance < amountUnits) {
        const approveTxHash = await (walletClient as any).writeContract({
          address:      src.usdc,
          abi:          erc20Abi,
          functionName: 'approve',
          args:         [src.tokenMessenger, amountUnits],
          account:      walletAddress as `0x${string}`,
          ...(src.approveGas ? { gas: src.approveGas } : {}),
        })
        await waitReceipt(srcClient, approveTxHash as Hex, src)
        onEvent('approve', 'success', approveTxHash)
      } else {
        onEvent('approve', 'success') // allowance sudah cukup
      }

      if (abortCtrl.current.signal.aborted) throw new Error('Bridge dibatalkan')

      // ── Step 2: Burn (depositForBurn) ──────────────────────────────
      onEvent('burn', 'pending')
      const burnTxHash = await (walletClient as any).writeContract({
        address:      src.tokenMessenger,
        abi:          TOKEN_MESSENGER_ABI,
        functionName: 'depositForBurn',
        args:         [amountUnits, dst.domain, addrToBytes32(dest), src.usdc, ZERO_BYTES32, CCTP_MAX_FEE, CCTP_FAST_FINALITY],
        account:      walletAddress as `0x${string}`,
        ...(src.burnGas ? { gas: src.burnGas } : {}),
      }) as string

      updateTx(txRecord.id, { burnTx: burnTxHash, status: 'attestation' }, walletAddress)
      const burnReceipt = await waitReceipt(srcClient, burnTxHash as Hex, src)

      // Extract messageBytes dari receipt
      let msgBytes = extractMessageBytes(burnReceipt.logs)
      if (!msgBytes) msgBytes = await fetchMsgBytesFromRpc(src.rpcUrls[0], burnTxHash, Number(burnReceipt.blockNumber))
      if (!msgBytes && src.rpcUrls[1]) msgBytes = await fetchMsgBytesFromRpc(src.rpcUrls[1], burnTxHash, Number(burnReceipt.blockNumber))
      if (!msgBytes) throw new Error('MessageSent event tidak ditemukan di receipt')

      const messageHash = keccak256(msgBytes)
      onEvent('burn', 'success', burnTxHash)

      if (abortCtrl.current.signal.aborted) throw new Error('Bridge dibatalkan')

      // ── Step 3: Attestation dari browser ──────────────────────────
      onEvent('fetchAttestation', 'pending')
      const attestation = await pollAttestation(
        src.domain, burnTxHash, messageHash,
        (msg) => onEvent('fetchAttestation', 'pending', undefined, msg),
        abortCtrl.current.signal,
      )
      onEvent('fetchAttestation', 'success')

      if (abortCtrl.current.signal.aborted) throw new Error('Bridge dibatalkan')

      // ── Step 4: Mint via server relayer ───────────────────────────
      onEvent('mint', 'pending')
      const direction = fromChain === BRIDGE_KIT_CHAIN_ARC ? 'arc-to-sepolia' : 'sepolia-to-arc'
      const mintRes = await fetch('/api/bridge/mint', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgBytes, att: attestation, direction }),
      })
      const mintData = await mintRes.json()

      if (!mintData.ok) {
        // Simpan untuk retry manual
        try {
          localStorage.setItem(`cctp_pending_mint_${walletAddress.toLowerCase()}`, JSON.stringify({
            msgBytes, att: attestation, direction, burnTxHash, timestamp: Date.now(),
          }))
        } catch { /* ignore */ }
        throw new Error(mintData.error || 'Mint gagal di destination chain')
      }

      const mintTxHash  = mintData.txHash as string | null
      const explorerUrl = mintData.explorerUrl as string | null
      onEvent('mint', 'success', mintTxHash ?? undefined)
      updateTx(txRecord.id, { mintTx: mintTxHash ?? '', status: 'success' }, walletAddress)
      try { localStorage.removeItem(`cctp_pending_mint_${walletAddress.toLowerCase()}`) } catch { /* ignore */ }

      setResult({ mintTxHash: mintTxHash ?? undefined, explorerUrl: explorerUrl ?? undefined })
      return { ok: true, mintTxHash, explorerUrl }

    } catch (e: any) {
      if (abortCtrl.current.signal.aborted) return { ok: false, error: 'Bridge dibatalkan' }
      const msg = e?.shortMessage || e?.message || 'Bridge gagal'
      setError(msg)
      updateTx(txRecord.id, { status: 'failed', errorMsg: msg }, walletAddress)
      onEvent('approve', 'error', undefined, msg)
      throw e
    } finally {
      setIsLoading(false)
    }
  }, [])

  function clear() {
    abortCtrl.current.abort()
    setError(null)
    setResult(null)
    setIsLoading(false)
  }

  // Stub untuk kompatibilitas
  async function estimate(_p: any) { return null }
  async function retry(_r: any, _p: any, _o: any) { return { ok: false } }

  return { executeBridge, isLoading, error, result, clear, estimate, retry }
}
