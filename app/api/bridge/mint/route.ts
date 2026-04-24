/**
 * app/api/bridge/mint/route.ts
 * Server-side mint via relayer wallet — bypass wallet restriction (OKX, dll).
 * POST { msgBytes, att, direction }
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createWalletClient, createPublicClient, http, fallback, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  ARC_MESSAGE_TRANSMITTER, ARC_RPC, ARC_RPC_BACKUP, ARC_RPC_BACKUP2, arcTestnet,
  SEPOLIA_MESSAGE_TRANSMITTER, SEPOLIA_RPC, SEPOLIA_RPC_BACKUP, SEPOLIA_RPC_FALLBACK3,
  ARC_EXPLORER, SEPOLIA_EXPLORER,
} from '@/lib/arcChain'

const MESSAGE_TRANSMITTER_ABI = [
  {
    type: 'function', name: 'receiveMessage', stateMutability: 'nonpayable',
    inputs: [{ name: 'message', type: 'bytes' }, { name: 'attestation', type: 'bytes' }],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const

function getRelayerAccount() {
  const pk = process.env.ARC_TREASURY_PRIVATE_KEY
  if (!pk) throw new Error('ARC_TREASURY_PRIVATE_KEY tidak di-set di .env')

  const clean = pk.trim().replace(/^['"]|['"]$/g, '')
  const hex   = clean.startsWith('0x') ? clean : `0x${clean}`

  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`Format private key salah (expected 64 hex chars, got ${clean.length})`)
  }
  if (hex === `0x${'0'.repeat(64)}`) throw new Error('Private key tidak boleh all-zeros')

  const placeholders = ['GANTI_DENGAN', 'your_private_key', 'xxx', 'YOUR_PRIVATE']
  if (placeholders.some(p => pk.toLowerCase().includes(p.toLowerCase()))) {
    throw new Error('ARC_TREASURY_PRIVATE_KEY masih placeholder')
  }

  return privateKeyToAccount(hex as `0x${string}`)
}

function isAlreadyMinted(msg: string): boolean {
  const m = msg.toLowerCase()
  return m.includes('nonce') || m.includes('already') || m.includes('used') || m.includes('duplicate')
}

export async function POST(req: Request) {
  try {
    const { msgBytes, att, direction } = await req.json()

    if (!msgBytes || !att || !direction) {
      return NextResponse.json({ ok: false, error: 'Missing msgBytes, att, or direction' }, { status: 400 })
    }

    const account = getRelayerAccount()

    if (direction === 'arc-to-sepolia') {
      // ── Mint di Sepolia ────────────────────────────────────────────────
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: fallback([http(SEPOLIA_RPC), http(SEPOLIA_RPC_BACKUP), http(SEPOLIA_RPC_FALLBACK3)]),
      })
      const walletClient = createWalletClient({
        account, chain: sepolia,
        transport: fallback([http(SEPOLIA_RPC), http(SEPOLIA_RPC_BACKUP)]),
      })

      // Simulate dulu
      try {
        await (publicClient as any).simulateContract({
          address: SEPOLIA_MESSAGE_TRANSMITTER, abi: MESSAGE_TRANSMITTER_ABI,
          functionName: 'receiveMessage', args: [msgBytes as Hex, att as Hex], account,
        })
      } catch (simErr: any) {
        const m = simErr?.shortMessage || simErr?.message || ''
        if (isAlreadyMinted(m)) return NextResponse.json({ ok: true, alreadyMinted: true, txHash: null })
        console.warn('[mint] Sepolia simulate gagal, mencoba writeContract:', m.slice(0, 200))
      }

      try {
        const hash = await (walletClient as any).writeContract({
          address: SEPOLIA_MESSAGE_TRANSMITTER, abi: MESSAGE_TRANSMITTER_ABI,
          functionName: 'receiveMessage', args: [msgBytes as Hex, att as Hex], account,
        })
        await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
        return NextResponse.json({ ok: true, txHash: hash, explorerUrl: `${SEPOLIA_EXPLORER}/tx/${hash}` })
      } catch (e: any) {
        const m = e?.shortMessage || e?.message || ''
        if (isAlreadyMinted(m)) return NextResponse.json({ ok: true, alreadyMinted: true, txHash: null })
        return NextResponse.json({ ok: false, error: `Mint di Sepolia gagal: ${m.slice(0, 300)}` }, { status: 500 })
      }

    } else if (direction === 'sepolia-to-arc') {
      // ── Mint di Arc ────────────────────────────────────────────────────
      const arcTransport = fallback([http(ARC_RPC), http(ARC_RPC_BACKUP), http(ARC_RPC_BACKUP2)])
      const arcPublic = createPublicClient({ chain: arcTestnet as any, transport: arcTransport }) as any
      const arcWallet = createWalletClient({ account, chain: arcTestnet as any, transport: arcTransport })

      // Simulate dulu
      try {
        await arcPublic.simulateContract({
          address: ARC_MESSAGE_TRANSMITTER, abi: MESSAGE_TRANSMITTER_ABI,
          functionName: 'receiveMessage', args: [msgBytes as Hex, att as Hex], account,
        })
      } catch (simErr: any) {
        const m = simErr?.shortMessage || simErr?.message || ''
        if (isAlreadyMinted(m)) return NextResponse.json({ ok: true, alreadyMinted: true, txHash: null })
        console.warn('[mint] Arc simulate gagal, mencoba writeContract:', m.slice(0, 200))
      }

      try {
        const hash = await (arcWallet as any).writeContract({
          address: ARC_MESSAGE_TRANSMITTER, abi: MESSAGE_TRANSMITTER_ABI,
          functionName: 'receiveMessage', args: [msgBytes as Hex, att as Hex],
          account,
          gas: 500_000n, // Arc RPC sering return gasEstimate = 0
        })

        // Tunggu receipt Arc dengan manual polling (waitForTransactionReceipt kadang timeout)
        const deadline = Date.now() + 180_000
        let receipt: any = null
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 1_500))
          try {
            receipt = await arcPublic.getTransactionReceipt({ hash })
            if (receipt?.status === 'success') break
            if (receipt?.status === 'reverted') throw new Error('receiveMessage reverted di Arc')
          } catch (e: any) {
            if (e?.message?.includes('reverted')) throw e
          }
        }
        if (!receipt) throw new Error('Timeout menunggu konfirmasi mint di Arc')

        return NextResponse.json({ ok: true, txHash: hash, explorerUrl: `${ARC_EXPLORER}/tx/${hash}` })
      } catch (e: any) {
        const m = e?.shortMessage || e?.message || ''
        if (isAlreadyMinted(m)) return NextResponse.json({ ok: true, alreadyMinted: true, txHash: null })
        return NextResponse.json({
          ok: false,
          error: `Mint di Arc gagal (gas issue atau RPC timeout): ${m.slice(0, 300)}`,
        }, { status: 500 })
      }

    } else {
      return NextResponse.json({ ok: false, error: 'Invalid direction' }, { status: 400 })
    }
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.shortMessage || e?.message || 'Server error',
    }, { status: 500 })
  }
}
