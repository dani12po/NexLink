/**
 * hooks/useBridge.ts
 * Manual CCTP V2 bridge — approve ERC-20 standar (kompatibel OKX/semua wallet).
 *
 * KENAPA TIDAK PAKAI BRIDGEKIT:
 * BridgeKit menggunakan Permit2 signature (EIP-712) untuk approve.
 * OKX Wallet memblokir Permit2 signature dengan pesan "Transaksi ini berisiko".
 * Solusi: pakai approve() ERC-20 standar yang semua wallet support.
 *
 * ARSITEKTUR:
 * - Approve + Burn: dari browser via wallet (ERC-20 approve standar)
 * - Attestation polling: dari browser langsung ke Iris (tidak kena IP block)
 * - Mint: via server relayer /api/bridge/mint (bypass wallet restriction)
 */
'use client'

import { useState, useCallback } from 'react'
import {
  createWalletClient, createPublicClient, custom, http, fallback,
  parseUnits, erc20Abi, keccak256, type Hex, type Log,
} from 'viem'
import { sepolia } from 'viem/chains'
import {
  ARC_CHAIN_ID_HEX, ARC_RPC, ARC_RPC_BACKUP, ARC_RPC_BACKUP2,
  ARC_USDC, ARC_TOKEN_MESSENGER, ARC_CCTP_DOMAIN,
  SEPOLIA_CHAIN_ID_HEX, SEPOLIA_RPC, SEPOLIA_RPC_BACKUP, SEPOLIA_RPC_FALLBACK3,
  SEPOLIA_USDC, SEPOLIA_TOKEN_MESSENGER, SEPOLIA_CCTP_DOMAIN,
  CCTP_FAST_FINALITY, CCTP_MAX_FEE, IRIS_API, arcTestnet,
  ARC_EXPLORER, SEPOLIA_EXPLORER,
  BRIDGE_KIT_CHAIN_ARC,
} from '@/lib/arcChain'
import { addTx, updateTx } from '@/lib/txHistory'
import { getEvmProvider } from '@/lib/evmProvider'

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
  fromChain:         string   // BRIDGE_KIT_CHAIN_ARC atau BRIDGE_KIT_CHAIN_SEPOLIA
  toChain:           string
  amount:            string
  walletAddress:     string
  recipientAddress?: string
  onEvent:           (method: string, state: string, txHash?: string, error?: string) => void
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
    [1, 'eth_getLogs', [{ fromBlock: blockHex, toBlock: blockHex, topics: [MESSAGE_SENT_TOPIC] }]],
    [2, 'eth_getTransactionReceipt', [txHash]],
    [3, 'eth_getLogs', [{ fromBlock: `0x${Math.max(0, blockNumber - 5).toString(16)}`, toBlock: `0x${(blockNumber + 2).toString(16)}`, topics: [MESSAGE_SENT_TOPIC] }]],
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

/** Arc: manual receipt polling 1.5s (deterministic finality) */
async function waitArcReceipt(client: any, hash: Hex, maxMs = 180_000): Promise<any> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    await sleep(1_500)
    try {
      const r = await client.getTransactionReceipt({ hash })
      if (r?.status === 'success') return r
      if (r?.status === 'reverted') throw new Error(`Transaksi reverted: ${hash}`)
    } catch (e: any) {
      if (e?.message?.includes('reverted')) throw e
    }
  }
  throw new Error('Timeout menunggu konfirmasi di Arc Testnet. Cek ArcScan untuk status.')
}

/**
 * Poll Circle Iris LANGSUNG dari browser.
 * Browser tidak kena IP restriction — Iris support CORS.
 * Vercel serverless diblokir Iris (403).
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
  isArcSource: boolean,
  onProgress: (msg: string) => void,
  abortSignal: AbortSignal,
): Promise<string> {
  const BASE  = isArcSource ? 2_000 : 5_000
  const MAX   = isArcSource ? 15_000 : 30_000
  const LIMIT = 30 * 60 * 1_000
  const start = Date.now()

  for (let i = 0; ; i++) {
    if (abortSignal.aborted) throw new Error('Bridge dibatalkan')
    if (Date.now() - start > LIMIT) throw new Error('Attestation timeout (30 menit). USDC sudah di-burn — coba mint manual nanti.')

    const delay = Math.min(BASE * Math.pow(1.3, Math.min(i, 10)), MAX)
    await sleep(delay)

    const elapsed = Math.floor((Date.now() - start) / 1_000)
    if (i % 3 === 0) {
      onProgress(isArcSource
        ? `Menunggu attestation… ${elapsed}s (Arc finality instan, biasanya 1–5 menit)`
        : `Menunggu attestation… ${elapsed}s (Sepolia ~12 blok, bisa 3–20 menit)`)
    }

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
  const abortRef = { current: new AbortController() }

  const executeBridge = useCallback(async (params: ExecuteBridgeParams) => {
    const { fromChain, toChain, amount, walletAddress, recipientAddress, onEvent } = params
    const isArcSource = fromChain === BRIDGE_KIT_CHAIN_ARC
    const dest        = (recipientAddress?.trim() || walletAddress) as `0x${string}`
    const amountUnits = parseUnits(amount, 6)

    const eth = getEvmProvider()
    if (!eth) throw new Error('Wallet tidak terdeteksi')

    abortRef.current = new AbortController()
    setIsLoading(true)
    setError(null)
    setResult(null)

    const txRecord = addTx({
      type: 'bridge', status: 'pending',
      direction: isArcSource ? 'arc-to-sepolia' : 'sepolia-to-arc',
      fromChain: isArcSource ? 'Arc Testnet' : 'Ethereum Sepolia',
      toChain:   isArcSource ? 'Ethereum Sepolia' : 'Arc Testnet',
      amountSent: amount, wallet: walletAddress,
    })

    try {
      // ── Setup clients ──────────────────────────────────────────────
      const srcChain  = isArcSource ? arcTestnet as any : sepolia
      const srcClient = isArcSource
        ? createPublicClient({ chain: arcTestnet as any, transport: fallback([http(ARC_RPC), http(ARC_RPC_BACKUP), http(ARC_RPC_BACKUP2)]) }) as any
        : createPublicClient({ chain: sepolia, transport: fallback([http(SEPOLIA_RPC), http(SEPOLIA_RPC_BACKUP), http(SEPOLIA_RPC_FALLBACK3)]) })

      const walletClient = createWalletClient({
        chain:     srcChain,
        transport: custom(eth),
        account:   walletAddress as `0x${string}`,
      })

      const srcUsdc      = isArcSource ? ARC_USDC      : SEPOLIA_USDC
      const srcMessenger = isArcSource ? ARC_TOKEN_MESSENGER : SEPOLIA_TOKEN_MESSENGER
      const dstDomain    = isArcSource ? SEPOLIA_CCTP_DOMAIN : ARC_CCTP_DOMAIN
      const srcDomain    = isArcSource ? ARC_CCTP_DOMAIN : SEPOLIA_CCTP_DOMAIN
      const srcRpc       = isArcSource ? ARC_RPC : SEPOLIA_RPC
      const srcRpcBackup = isArcSource ? ARC_RPC_BACKUP : SEPOLIA_RPC_BACKUP

      // ── Switch chain ───────────────────────────────────────────────
      const chainIdHex = isArcSource ? ARC_CHAIN_ID_HEX : SEPOLIA_CHAIN_ID_HEX
      if (isArcSource) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: ARC_CHAIN_ID_HEX, chainName: 'Arc Testnet',
              rpcUrls: [ARC_RPC],
              nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
              blockExplorerUrls: [ARC_EXPLORER],
            }],
          })
        } catch (e: any) {
          if (e?.code === 4001) throw new Error('User menolak switch chain')
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
        }
      } else {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
      }

      // ── Step 1: Approve ERC-20 standar (bukan Permit2) ────────────
      onEvent('approve', 'pending')
      const allowance = await srcClient.readContract({
        address: srcUsdc, abi: erc20Abi, functionName: 'allowance',
        args: [walletAddress as `0x${string}`, srcMessenger],
      }) as bigint

      if (allowance < amountUnits) {
        const approveArgs: any = {
          address: srcUsdc, abi: erc20Abi, functionName: 'approve',
          args: [srcMessenger, amountUnits],
          account: walletAddress as `0x${string}`,
        }
        if (isArcSource) approveArgs.gas = 100_000n

        const approveTxHash = await (walletClient as any).writeContract(approveArgs)

        if (isArcSource) {
          await waitArcReceipt(srcClient, approveTxHash as Hex)
        } else {
          await (srcClient as any).waitForTransactionReceipt({
            hash: approveTxHash as Hex, confirmations: 1,
            timeout: 180_000, pollingInterval: 3_000,
          })
        }
        onEvent('approve', 'success', approveTxHash)
      } else {
        onEvent('approve', 'success') // sudah approved sebelumnya
      }

      if (abortRef.current.signal.aborted) throw new Error('Bridge dibatalkan')

      // ── Step 2: Burn (depositForBurn) ──────────────────────────────
      onEvent('burn', 'pending')
      const burnArgs: any = {
        address: srcMessenger, abi: TOKEN_MESSENGER_ABI, functionName: 'depositForBurn',
        args: [amountUnits, dstDomain, addrToBytes32(dest), srcUsdc, ZERO_BYTES32, CCTP_MAX_FEE, CCTP_FAST_FINALITY],
        account: walletAddress as `0x${string}`,
      }
      if (isArcSource) burnArgs.gas = 300_000n

      const burnTxHash = await (walletClient as any).writeContract(burnArgs) as string
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

      let msgBytes = extractMessageBytes(burnReceipt.logs as Log[])
      if (!msgBytes) msgBytes = await fetchMsgBytesFromRpc(srcRpc, burnTxHash, Number(burnReceipt.blockNumber))
      if (!msgBytes) msgBytes = await fetchMsgBytesFromRpc(srcRpcBackup, burnTxHash, Number(burnReceipt.blockNumber))
      if (!msgBytes) throw new Error('MessageSent event tidak ditemukan di receipt')

      const messageHash = keccak256(msgBytes)
      onEvent('burn', 'success', burnTxHash)

      if (abortRef.current.signal.aborted) throw new Error('Bridge dibatalkan')

      // ── Step 3: Attestation dari browser ──────────────────────────
      onEvent('fetchAttestation', 'pending')
      const attestation = await pollAttestation(
        srcDomain, burnTxHash, messageHash, isArcSource,
        (msg) => onEvent('fetchAttestation', 'pending', undefined, msg),
        abortRef.current.signal,
      )
      onEvent('fetchAttestation', 'success')

      if (abortRef.current.signal.aborted) throw new Error('Bridge dibatalkan')

      // ── Step 4: Mint via server relayer ───────────────────────────
      onEvent('mint', 'pending')
      const direction = isArcSource ? 'arc-to-sepolia' : 'sepolia-to-arc'
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

      const mintTxHash = mintData.txHash as string | null
      const explorerUrl = mintData.explorerUrl as string | null
      onEvent('mint', 'success', mintTxHash ?? undefined)
      updateTx(txRecord.id, { mintTx: mintTxHash ?? '', status: 'success' }, walletAddress)
      try { localStorage.removeItem(`cctp_pending_mint_${walletAddress.toLowerCase()}`) } catch { /* ignore */ }

      setResult({ mintTxHash: mintTxHash ?? undefined, explorerUrl: explorerUrl ?? undefined })
      return { ok: true, mintTxHash, explorerUrl }

    } catch (e: any) {
      if (abortRef.current.signal.aborted) return { ok: false, error: 'Bridge dibatalkan' }
      const msg = e?.shortMessage || e?.message || 'Bridge gagal'
      setError(msg)
      updateTx(txRecord.id, { status: 'failed', errorMsg: msg }, walletAddress)
      onEvent('approve', 'error', undefined, msg) // trigger error state di UI
      throw e
    } finally {
      setIsLoading(false)
    }
  }, [])

  function clear() {
    abortRef.current.abort()
    setError(null)
    setResult(null)
    setIsLoading(false)
  }

  // estimate tidak dipakai lagi tapi dipertahankan untuk kompatibilitas
  async function estimate(_params: any) { return null }
  async function retry(_r: any, _p: any, _o: any) { return { ok: false } }

  return { executeBridge, isLoading, error, result, clear, estimate, retry }
}
