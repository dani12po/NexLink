/**
 * hooks/useBridge.ts
 * State machine untuk bridge USDC via Circle CCTP V2.
 *
 * ARSITEKTUR PENTING:
 * - Attestation polling dilakukan LANGSUNG dari browser ke Iris API
 *   (bukan via server proxy) karena Vercel IP diblokir Circle Iris (403).
 * - Arc receipt polling menggunakan interval 1.5s (Arc = deterministic finality).
 * - Gas selalu di-hardcode untuk Arc (RPC sering return estimasi = 0).
 * - Fee diambil dari Circle API resmi: GET /v2/burn/USDC/fees
 *   Ref: https://developers.circle.com/cctp/howtos/get-transfer-fee
 */
'use client'

import { useState, useCallback, useRef } from 'react'
import {
  createWalletClient, createPublicClient, custom, http, fallback,
  parseUnits, formatUnits, erc20Abi, keccak256, type Hex, type Log,
} from 'viem'
import { sepolia } from 'viem/chains'
import {
  ARC_CHAIN_ID_HEX, ARC_RPC, ARC_RPC_BACKUP, ARC_RPC_BACKUP2,
  ARC_USDC, ARC_TOKEN_MESSENGER, ARC_MESSAGE_TRANSMITTER, ARC_CCTP_DOMAIN,
  SEPOLIA_CHAIN_ID_HEX, SEPOLIA_RPC, SEPOLIA_RPC_BACKUP, SEPOLIA_RPC_FALLBACK3,
  SEPOLIA_USDC, SEPOLIA_TOKEN_MESSENGER, SEPOLIA_CCTP_DOMAIN,
  CCTP_FAST_FINALITY, IRIS_API, arcTestnet,
  ARC_EXPLORER, SEPOLIA_EXPLORER,
} from '@/lib/arcChain'
import { addTx, updateTx } from '@/lib/txHistory'

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
export type BridgeStatus =
  | 'idle' | 'approving' | 'burning'
  | 'awaiting_attestation' | 'minting' | 'success' | 'error'

export interface CctpFeeInfo {
  /** Fee dalam USDC units (6 decimals) */
  feeUnits:    bigint
  /** Fee dalam USDC string (human readable) */
  feeUsdc:     string
  /** minFinalityThreshold yang dipakai (1000=Fast, 2000=Standard) */
  finality:    number
  /** Apakah Fast Transfer tersedia (ada allowance) */
  isFast:      boolean
}

/**
 * Ambil fee CCTP dari Circle API resmi.
 * GET /v2/burn/USDC/fees?sourceDomain=&destinationDomain=
 * Ref: https://developers.circle.com/cctp/howtos/get-transfer-fee
 *
 * Fee dalam basis points (1 = 0.01%).
 * Untuk amount kecil di testnet, fee minimum = 1 unit (0.000001 USDC).
 */
export async function fetchCctpFee(
  sourceDomain: number,
  destinationDomain: number,
  amountUnits: bigint,
): Promise<CctpFeeInfo> {
  try {
    const res = await fetch(
      `${IRIS_API}/v2/burn/USDC/fees?sourceDomain=${sourceDomain}&destinationDomain=${destinationDomain}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) },
    )
    if (res.ok) {
      const data = await res.json() as any
      // Response: { fees: [{ finalityThreshold: 1000, minimumFee: 1 }, { finalityThreshold: 2000, minimumFee: 0 }] }
      const fees: Array<{ finalityThreshold: number; minimumFee: number }> = data?.fees ?? []

      // Pilih Fast Transfer (1000) jika ada, fallback ke Standard (2000)
      const fastFee     = fees.find(f => f.finalityThreshold === 1000)
      const standardFee = fees.find(f => f.finalityThreshold === 2000)
      const chosen      = fastFee ?? standardFee

      if (chosen) {
        // minimumFee dalam basis points (1 = 0.01%)
        // Fee = max(minimumFee_units, amount * bps / 10000)
        // Untuk testnet minimumFee biasanya 1 unit = 0.000001 USDC
        const bps        = BigInt(chosen.minimumFee)
        const feeByBps   = (amountUnits * bps) / 10_000n
        const feeUnits   = feeByBps < 1n ? 1n : feeByBps  // minimum 1 unit
        const feeUsdc    = formatUnits(feeUnits, 6)
        return {
          feeUnits,
          feeUsdc,
          finality: chosen.finalityThreshold,
          isFast:   chosen.finalityThreshold === 1000,
        }
      }
    }
  } catch { /* fallback ke default */ }

  // Fallback: 0.001 USDC flat (1000 units) jika API tidak tersedia
  return {
    feeUnits: 1_000n,
    feeUsdc:  '0.001000',
    finality: CCTP_FAST_FINALITY,
    isFast:   true,
  }
}

/**
 * Cek sisa Fast Transfer allowance dari Circle API.
 * GET /v2/fastBurn/USDC/allowance
 * Ref: https://developers.circle.com/cctp/howtos/get-fast-transfer-allowance
 */
export async function fetchFastAllowance(): Promise<string | null> {
  try {
    const res = await fetch(
      `${IRIS_API}/v2/fastBurn/USDC/allowance`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000) },
    )
    if (res.ok) {
      const data = await res.json() as any
      return data?.allowance ?? null
    }
  } catch { /* ignore */ }
  return null
}

export interface BridgeState {
  status:      BridgeStatus
  step:        number          // 0=idle, 1=approve, 2=burn, 3=attest, 4=mint
  burnTxHash:  string | null
  mintTxHash:  string | null
  explorerUrl: string | null
  error:       string | null
  progressMsg: string
  elapsedSec:  number
}

export interface ExecuteBridgeParams {
  amount:           string
  direction:        BridgeDirection
  recipientAddress?: string
  walletProvider:   any  // window.ethereum / EIP-1193 provider
  walletAddress:    string
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const MESSAGE_SENT_TOPIC = '0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036'
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
const PENDING_MINT_KEY = (addr: string) => `cctp_pending_mint_${addr.toLowerCase()}`

function addrToBytes32(addr: string): Hex {
  return `0x${addr.replace(/^0x/, '').toLowerCase().padStart(64, '0')}` as Hex
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

/** Extract messageBytes dari event log MessageSent */
function extractMessageBytes(logs: Log[]): Hex | null {
  for (const log of logs) {
    if ((log.topics[0] as string)?.toLowerCase() !== MESSAGE_SENT_TOPIC) continue
    const data = log.data as string
    if (!data || data === '0x') continue
    try {
      const hex       = data.startsWith('0x') ? data.slice(2) : data
      const byteLen   = parseInt(hex.slice(64, 128), 16)
      const payload   = hex.slice(128, 128 + byteLen * 2)
      if (payload.length === byteLen * 2) return `0x${payload}` as Hex
    } catch { /* skip */ }
  }
  return null
}

/**
 * Fallback: ambil messageBytes via RPC jika tidak ada di receipt.
 * Coba 3 strategi: exact block, receipt re-fetch, range ±5 blocks.
 */
async function fetchMsgBytesFromRpc(rpcUrl: string, txHash: string, blockNumber: number): Promise<Hex | null> {
  const blockHex = `0x${blockNumber.toString(16)}`
  const strategies = [
    { id: 1, method: 'eth_getLogs',              params: [{ fromBlock: blockHex, toBlock: blockHex, topics: [MESSAGE_SENT_TOPIC] }] },
    { id: 2, method: 'eth_getTransactionReceipt', params: [txHash] },
    { id: 3, method: 'eth_getLogs',              params: [{ fromBlock: `0x${Math.max(0, blockNumber - 5).toString(16)}`, toBlock: `0x${(blockNumber + 2).toString(16)}`, topics: [MESSAGE_SENT_TOPIC] }] },
  ]
  for (const s of strategies) {
    try {
      const res  = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: s.id, method: s.method, params: s.params }) })
      const json = await res.json()
      const logs: any[] = s.id === 2 ? (json?.result?.logs ?? []) : (json?.result ?? [])
      const txLogs = logs.filter((l: any) => l.transactionHash?.toLowerCase() === txHash.toLowerCase())
      const r = extractMessageBytes(txLogs as Log[]) ?? extractMessageBytes(logs as Log[])
      if (r) return r
    } catch { /* try next */ }
  }
  return null
}

/**
 * Tunggu receipt di Arc dengan interval 1.5s.
 * Arc = deterministic finality, 1 blok sudah final (~1-2 detik).
 * JANGAN pakai waitForTransactionReceipt viem — Arc RPC kadang timeout.
 */
async function waitArcReceipt(client: any, hash: Hex, maxMs = 180_000): Promise<any> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    await sleep(1_500)
    try {
      const r = await client.getTransactionReceipt({ hash })
      if (r?.status === 'success') return r
      if (r?.status === 'reverted') throw new Error(`Transaksi reverted di Arc: ${hash}`)
    } catch (e: any) {
      if (e?.message?.includes('reverted')) throw e
      // RPC error sementara → retry
    }
  }
  throw new Error('Timeout menunggu konfirmasi di Arc Testnet. Cek ArcScan untuk status.')
}

/**
 * Poll Circle Iris LANGSUNG dari browser.
 * Browser tidak kena IP restriction — Iris support CORS untuk browser.
 * Vercel serverless diblokir Iris (403 "Host not in allowlist").
 */
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
  } catch { /* timeout atau network error */ }
  return null
}

/** Fallback: poll via server proxy jika CORS gagal */
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

/**
 * Poll attestation dengan exponential backoff.
 * Coba direct (browser→Iris) dulu, fallback ke proxy jika gagal.
 * Arc→Sepolia: start 2s, max 15s (Arc finality instan)
 * Sepolia→Arc: start 5s, max 30s (Sepolia ~12 blok konfirmasi)
 */
async function pollAttestation(
  sourceDomain: number,
  txHash: string,
  messageHash: string,
  isArcSource: boolean,
  onProgress: (msg: string, elapsed: number) => void,
  abortSignal: AbortSignal,
): Promise<string> {
  const BASE  = isArcSource ? 2_000 : 5_000
  const MAX   = isArcSource ? 15_000 : 30_000
  const LIMIT = 30 * 60 * 1_000 // 30 menit timeout
  const start = Date.now()

  for (let i = 0; ; i++) {
    if (abortSignal.aborted) throw new Error('Bridge dibatalkan')
    const elapsed = Math.floor((Date.now() - start) / 1_000)
    if (Date.now() - start > LIMIT) throw new Error('Attestation timeout (30 menit). USDC sudah di-burn — coba mint manual nanti.')

    const delay = Math.min(BASE * Math.pow(1.3, Math.min(i, 10)), MAX)
    await sleep(delay)

    if (i % 3 === 0) {
      onProgress(
        isArcSource
          ? `Menunggu attestation Circle Iris… ${elapsed}s (Arc finality instan, biasanya 1–5 menit)`
          : `Menunggu attestation Circle Iris… ${elapsed}s (Sepolia ~12 blok, bisa 3–20 menit)`,
        elapsed,
      )
    }

    // Coba direct dari browser dulu (tidak kena IP block)
    const att = await pollIrisDirect(sourceDomain, txHash)
      ?? await pollIrisViaProxy(sourceDomain, txHash, messageHash)

    if (att) return att
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────────
const INITIAL: BridgeState = {
  status: 'idle', step: 0,
  burnTxHash: null, mintTxHash: null, explorerUrl: null,
  error: null, progressMsg: '', elapsedSec: 0,
}

export function useBridge() {
  const [state, setState] = useState<BridgeState>(INITIAL)
  const abortCtrl = useRef<AbortController | null>(null)

  function update(patch: Partial<BridgeState>) {
    setState(prev => ({ ...prev, ...patch }))
  }

  function reset() {
    abortCtrl.current?.abort()
    setState(INITIAL)
  }

  const executeBridge = useCallback(async ({
    amount, direction, recipientAddress, walletProvider, walletAddress,
  }: ExecuteBridgeParams) => {
    abortCtrl.current?.abort()
    const abort = new AbortController()
    abortCtrl.current = abort

    const isArcSource = direction === 'arc-to-sepolia'
    const dest        = (recipientAddress?.trim() || walletAddress) as `0x${string}`
    const amountUnits = parseUnits(amount, 6)

    // Ambil fee dari Circle API resmi
    const srcDomain = isArcSource ? ARC_CCTP_DOMAIN : SEPOLIA_CCTP_DOMAIN
    const dstDomain = isArcSource ? SEPOLIA_CCTP_DOMAIN : ARC_CCTP_DOMAIN
    const feeInfo   = await fetchCctpFee(srcDomain, dstDomain, amountUnits)

    const txRecord = addTx({
      type: 'bridge', status: 'pending', direction,
      fromChain:      isArcSource ? 'Arc Testnet' : 'Ethereum Sepolia',
      toChain:        isArcSource ? 'Ethereum Sepolia' : 'Arc Testnet',
      amountSent:     amount,
      amountReceived: formatUnits(amountUnits - feeInfo.feeUnits, 6),
      fee:            feeInfo.feeUsdc,
      wallet:         walletAddress,
    })

    try {
      // ── Setup clients ────────────────────────────────────────────────
      const srcChain  = isArcSource ? arcTestnet as any : sepolia
      const srcClient = isArcSource
        ? createPublicClient({ chain: arcTestnet as any, transport: fallback([http(ARC_RPC), http(ARC_RPC_BACKUP), http(ARC_RPC_BACKUP2)]) }) as any
        : createPublicClient({ chain: sepolia, transport: fallback([http(SEPOLIA_RPC), http(SEPOLIA_RPC_BACKUP), http(SEPOLIA_RPC_FALLBACK3)]) })

      const walletClient = createWalletClient({
        chain:     srcChain,
        transport: custom(walletProvider),
        account:   walletAddress as `0x${string}`,
      })

      const srcUsdc      = isArcSource ? ARC_USDC      : SEPOLIA_USDC
      const srcMessenger = isArcSource ? ARC_TOKEN_MESSENGER : SEPOLIA_TOKEN_MESSENGER
      const srcRpc       = isArcSource ? ARC_RPC : SEPOLIA_RPC
      const srcRpcBackup = isArcSource ? ARC_RPC_BACKUP : SEPOLIA_RPC_BACKUP

      // ── Step 1: Switch chain ─────────────────────────────────────────
      if (isArcSource) {
        // Selalu wallet_addEthereumChain untuk Arc agar override nama "Core" di wallet
        try {
          await walletProvider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId:     ARC_CHAIN_ID_HEX,
              chainName:   'Arc Testnet',
              rpcUrls:     [ARC_RPC],
              nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
              blockExplorerUrls: [ARC_EXPLORER],
            }],
          })
        } catch (e: any) {
          if (e?.code === 4001) throw new Error('User menolak switch chain')
          // Chain sudah ada → coba switch biasa
          await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_CHAIN_ID_HEX }] })
        }
      } else {
        await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }] })
      }

      // ── Step 2: Approve ──────────────────────────────────────────────
      update({ status: 'approving', step: 1, progressMsg: 'Menyetujui USDC…' })

      const allowance = await srcClient.readContract({
        address: srcUsdc, abi: erc20Abi, functionName: 'allowance',
        args: [walletAddress as `0x${string}`, srcMessenger],
      }) as bigint

      let approveTxHash: string | null = null
      if (allowance < amountUnits) {
        const approveArgs: any = {
          address: srcUsdc, abi: erc20Abi, functionName: 'approve',
          args: [srcMessenger, amountUnits],
          account: walletAddress as `0x${string}`,
        }
        // Arc RPC sering return gasEstimate = 0 — hardcode gas
        if (isArcSource) approveArgs.gas = 100_000n

        approveTxHash = await (walletClient as any).writeContract(approveArgs)
        update({ progressMsg: 'Menunggu konfirmasi approve…' })

        if (isArcSource) {
          await waitArcReceipt(srcClient, approveTxHash as Hex)
        } else {
          await (srcClient as any).waitForTransactionReceipt({
            hash: approveTxHash as Hex, confirmations: 1,
            timeout: 180_000, pollingInterval: 3_000,
          })
        }
      }

      if (abort.signal.aborted) throw new Error('Bridge dibatalkan')

      // ── Step 3: Burn (depositForBurn) ────────────────────────────────
      update({ status: 'burning', step: 2, progressMsg: 'Mengirim USDC ke bridge…' })

      const burnArgs: any = {
        address:      srcMessenger,
        abi:          TOKEN_MESSENGER_ABI,
        functionName: 'depositForBurn',
        args: [
          amountUnits,
          dstDomain,
          addrToBytes32(dest),
          srcUsdc,
          ZERO_BYTES32,
          feeInfo.feeUnits,      // maxFee dari Circle API
          feeInfo.finality,      // minFinalityThreshold dari Circle API
        ],
        account: walletAddress as `0x${string}`,
      }
      if (isArcSource) burnArgs.gas = 300_000n

      const burnTxHash = await (walletClient as any).writeContract(burnArgs) as string
      update({ burnTxHash, progressMsg: 'Menunggu konfirmasi burn…' })
      updateTx(txRecord.id, { burnTx: burnTxHash, status: 'attestation' }, walletAddress)

      let burnReceipt: any
      if (isArcSource) {
        burnReceipt = await waitArcReceipt(srcClient, burnTxHash as Hex)
      } else {
        burnReceipt = await (srcClient as any).waitForTransactionReceipt({
          hash: burnTxHash as Hex, confirmations: 1,
          timeout: 180_000, pollingInterval: 3_000,
        })
      }

      // Extract messageBytes dari receipt
      let msgBytes = extractMessageBytes(burnReceipt.logs as Log[])
      if (!msgBytes) msgBytes = await fetchMsgBytesFromRpc(srcRpc, burnTxHash, Number(burnReceipt.blockNumber))
      if (!msgBytes) msgBytes = await fetchMsgBytesFromRpc(srcRpcBackup, burnTxHash, Number(burnReceipt.blockNumber))
      if (!msgBytes) throw new Error('MessageSent event tidak ditemukan di receipt. Coba refresh dan retry.')

      const messageHash = keccak256(msgBytes)

      if (abort.signal.aborted) throw new Error('Bridge dibatalkan')

      // ── Step 4: Attestation (LANGSUNG dari browser ke Iris) ──────────
      update({ status: 'awaiting_attestation', step: 3 })

      const attestation = await pollAttestation(
        srcDomain, burnTxHash, messageHash, isArcSource,
        (msg, elapsed) => update({ progressMsg: msg, elapsedSec: elapsed }),
        abort.signal,
      )

      if (abort.signal.aborted) throw new Error('Bridge dibatalkan')

      // ── Step 5: Mint di destination chain (via server relayer) ───────
      update({ status: 'minting', step: 4, progressMsg: 'Minting USDC di destination chain…' })

      const mintRes = await fetch('/api/bridge/mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgBytes, att: attestation, direction }),
      })
      const mintData = await mintRes.json()

      if (!mintData.ok) {
        // Simpan untuk retry manual
        try {
          localStorage.setItem(PENDING_MINT_KEY(walletAddress), JSON.stringify({
            msgBytes, att: attestation, direction,
            burnTxHash, timestamp: Date.now(),
          }))
        } catch { /* ignore */ }
        throw new Error(mintData.error || 'Mint gagal di destination chain')
      }

      if (mintData.alreadyMinted) {
        update({ status: 'success', step: 4, mintTxHash: null, progressMsg: 'USDC sudah berhasil di-mint sebelumnya ✅' })
      } else {
        const mintTxHash = mintData.txHash as string
        update({ status: 'success', step: 4, mintTxHash, explorerUrl: mintData.explorerUrl, progressMsg: 'Bridge selesai! ✅' })
        updateTx(txRecord.id, { mintTx: mintTxHash, status: 'success' }, walletAddress)
        // Hapus pending mint jika ada
        try { localStorage.removeItem(PENDING_MINT_KEY(walletAddress)) } catch { /* ignore */ }
      }

    } catch (e: any) {
      if (abort.signal.aborted) return // dibatalkan user, tidak perlu update error
      const msg = e?.shortMessage || e?.message || 'Bridge gagal'
      update({ status: 'error', error: msg, progressMsg: msg })
      updateTx(txRecord.id, { status: 'failed', errorMsg: msg }, walletAddress)
    }
  }, [])

  /** Retry mint dari localStorage (jika browser ditutup sebelum mint selesai) */
  const retryPendingMint = useCallback(async (walletAddress: string) => {
    const raw = localStorage.getItem(PENDING_MINT_KEY(walletAddress))
    if (!raw) return false
    try {
      const { msgBytes, att, direction } = JSON.parse(raw)
      update({ status: 'minting', step: 4, progressMsg: 'Mencoba mint ulang…' })
      const res  = await fetch('/api/bridge/mint', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgBytes, att, direction }),
      })
      const data = await res.json()
      if (data.ok) {
        update({ status: 'success', step: 4, mintTxHash: data.txHash ?? null, explorerUrl: data.explorerUrl ?? null, progressMsg: 'Mint berhasil ✅' })
        localStorage.removeItem(PENDING_MINT_KEY(walletAddress))
        return true
      }
      update({ status: 'error', error: data.error || 'Retry mint gagal' })
      return false
    } catch (e: any) {
      update({ status: 'error', error: e?.message || 'Retry mint gagal' })
      return false
    }
  }, [])

  function hasPendingMint(walletAddress: string): boolean {
    try { return !!localStorage.getItem(PENDING_MINT_KEY(walletAddress)) } catch { return false }
  }

  return { state, executeBridge, reset, retryPendingMint, hasPendingMint }
}
