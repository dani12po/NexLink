// app/api/send-usdc/route.js
import { NextResponse } from 'next/server'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  erc20Abi,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// Pilih chain yang kamu pakai:
const CHAIN = (process.env.BASE_CHAIN === 'sepolia') ? baseSepolia : base

// USDC address sesuai chain
const USDC =
  CHAIN.id === 8453
    ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // Base mainnet :contentReference[oaicite:5]{index=5}
    : '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // Base Sepolia :contentReference[oaicite:6]{index=6}

const RPC_URL = process.env.BASE_RPC_URL
const account = privateKeyToAccount(process.env.FAUCET_PK) // 0x...

const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) })
const walletClient = createWalletClient({ chain: CHAIN, transport: http(RPC_URL), account })

export async function POST(req) {
  try {
    const { to, amount } = await req.json() // amount contoh: "1.25" (USDC)

    if (!to || !amount) {
      return NextResponse.json({ ok: false, error: 'missing to/amount' }, { status: 400 })
    }

    // 1) cek decimals (jangan asumsi)
    const decimals = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'decimals',
    })

    // 2) parse amount dengan decimals bener
    const value = parseUnits(String(amount), Number(decimals))

    // 3) cek saldo USDC faucet
    const usdcBal = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    })
    if (usdcBal < value) {
      return NextResponse.json({
        ok: false,
        error: `insufficient USDC balance. faucet=${account.address}`,
      }, { status: 400 })
    }

    // 4) cek ETH gas faucet
    const ethBal = await publicClient.getBalance({ address: account.address })
    if (ethBal === 0n) {
      return NextResponse.json({
        ok: false,
        error: `insufficient ETH for gas. faucet=${account.address}`,
      }, { status: 400 })
    }

    // 5) simulate dulu (biar ketauan kalau bakal revert)
    const { request } = await publicClient.simulateContract({
      account,
      address: USDC,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, value],
    })

    // 6) kirim tx
    const hash = await walletClient.writeContract(request)

    return NextResponse.json({ ok: true, hash })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e?.shortMessage || e?.message || 'unknown error',
    }, { status: 500 })
  }
}
