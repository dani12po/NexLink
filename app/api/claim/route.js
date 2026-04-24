// app/api/claim/route.js
export const runtime = 'nodejs'

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  erc20Abi,
  http,
  parseEther,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'

/* =========================
   ENV (server)
========================= */
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org'
const TREASURY = (process.env.TREASURY || '').toLowerCase()
const BASE_USDC = (process.env.BASE_USDC || '').toLowerCase()

// Pay rules
const PAY_USDC = String(process.env.PAY_USDC || '0.1') // USDC, 6 decimals
const PAY_ETH = process.env.PAY_ETH ? String(process.env.PAY_ETH) : '' // fixed ETH min (recommended)

// Optional USD->ETH via Chainlink (only used if PAY_ETH is empty)
const PAY_USD = process.env.PAY_USD ? Number(process.env.PAY_USD) : 0
const ETH_USD_FEED = (process.env.ETH_USD_FEED || '').toLowerCase()
const ETH_USD_SLIPPAGE_BPS = Number(process.env.ETH_USD_SLIPPAGE_BPS || 200)

// Arc
const ARC_RPC_URL = process.env.ARC_RPC_URL || ''
const ARC_USDC = (process.env.ARC_USDC || '').toLowerCase()
const REWARD_USDC = String(process.env.REWARD_USDC || '10')
const ARC_TREASURY_PRIVATE_KEY = process.env.ARC_TREASURY_PRIVATE_KEY || ''

// Rate limit
const COOLDOWN_SEC = Number(process.env.WALLET_CLAIM_COOLDOWN_SEC || 7200)

// KV (optional but recommended)
const KV_URL = process.env.KV_REST_API_URL || ''
const KV_TOKEN = process.env.KV_REST_API_TOKEN || ''
const HAS_KV = Boolean(KV_URL && KV_TOKEN)

// in-memory fallback (local/dev)
const mem = globalThis.__ARC_MEM__ || (globalThis.__ARC_MEM__ = new Map())

/* =========================
   Clients
========================= */
const baseClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
})

// Arc chain id: fetch once then cache
let _arcChain = null
async function getArcChain() {
  if (_arcChain) return _arcChain
  if (!ARC_RPC_URL) throw new Error('Missing ARC_RPC_URL')

  const r = await fetch(ARC_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    cache: 'no-store',
  })
  const j = await r.json()
  const id = parseInt(j?.result || '0x0', 16)
  if (!id) throw new Error('Unable to fetch Arc chainId')

  _arcChain = {
    id,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
    rpcUrls: { default: { http: [ARC_RPC_URL] } },
    blockExplorers: {
      default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
    },
  }
  return _arcChain
}

/* =========================
   Helpers
========================= */
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
}

function normAddr(a) {
  return String(a || '').trim().toLowerCase()
}

function normHash(h) {
  return String(h || '').trim().toLowerCase()
}

function fmtWait(sec) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}h ${m}m ${r}s`
  if (m > 0) return `${m}m ${r}s`
  return `${r}s`
}

// ✅ accept private key with or without 0x
function normalizePrivKey(pkRaw) {
  const s0 = String(pkRaw || '').trim()
  const s1 = s0.replace(/^['"]|['"]$/g, '') // remove quotes if present
  const s = s1.startsWith('0x') ? s1 : `0x${s1}`

  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) {
    throw new Error(
      'Server wallet misconfigured: ARC_TREASURY_PRIVATE_KEY must be 64 hex characters (with or without 0x).'
    )
  }
  return s
}

async function kvGet(key) {
  if (!HAS_KV) return mem.get(key) ?? null
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
  })
  const j = await r.json()
  return j?.result ?? null
}

async function kvSet(key, value, exSec) {
  if (!HAS_KV) {
    mem.set(key, value)
    if (exSec) setTimeout(() => mem.delete(key), exSec * 1000).unref?.()
    return
  }
  const ex = exSec ? `?ex=${Number(exSec)}` : ''
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}${ex}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
  })
}

/* =========================
   Payment verification (Base)
========================= */
const feedAbi = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
]

async function getMinEthWei() {
  // Prefer fixed PAY_ETH if provided
  if (PAY_ETH) return parseEther(PAY_ETH)

  // Otherwise compute from USD
  if (!PAY_USD || !ETH_USD_FEED) {
    throw new Error('Missing PAY_ETH (or PAY_USD + ETH_USD_FEED)')
  }

  const decimals = await baseClient.readContract({
    address: ETH_USD_FEED,
    abi: feedAbi,
    functionName: 'decimals',
  })

  const rd = await baseClient.readContract({
    address: ETH_USD_FEED,
    abi: feedAbi,
    functionName: 'latestRoundData',
  })

  const answer = rd[1]
  if (!answer || answer <= 0n) throw new Error('Invalid Chainlink price')

  const scale = 10n ** BigInt(decimals)
  const priceScaled = BigInt(answer)
  const usdScaled = BigInt(Math.floor(PAY_USD * 1e6))

  let wei = (usdScaled * (10n ** 18n) * scale) / (priceScaled * 1_000_000n)
  wei = (wei * BigInt(10_000 + ETH_USD_SLIPPAGE_BPS)) / 10_000n
  return wei
}

async function verifyBasePayment({ userAddress, txHash }) {
  const tx = await baseClient.getTransaction({ hash: txHash })
  if (!tx) throw new Error('Payment tx not found on Base')

  const receipt = await baseClient.getTransactionReceipt({ hash: txHash })
  if (!receipt || receipt.status !== 'success') throw new Error('Payment tx failed')

  const from = normAddr(tx.from)
  if (from !== userAddress) {
    throw new Error('Wallet mismatch. Please switch back to the wallet you used for the payment, then try again.')
  }

  const to = tx.to ? normAddr(tx.to) : ''

  // ETH payment: direct to treasury
  if (to === TREASURY) {
    const minWei = await getMinEthWei()
    if (tx.value < minWei) throw new Error('ETH payment amount too low')
    return { method: 'ETH' }
  }

  // USDC payment: tx to token contract + Transfer event
  if (to === BASE_USDC) {
    const min = parseUnits(PAY_USDC, 6)

    let ok = false
    for (const log of receipt.logs) {
      if (normAddr(log.address) !== BASE_USDC) continue
      try {
        const ev = decodeEventLog({
          abi: erc20Abi,
          data: log.data,
          topics: log.topics,
        })
        if (ev?.eventName !== 'Transfer') continue

        const f = normAddr(ev.args.from)
        const t = normAddr(ev.args.to)
        const v = BigInt(ev.args.value)

        if (f === userAddress && t === TREASURY && v >= min) {
          ok = true
          break
        }
      } catch {
        // ignore
      }
    }

    if (!ok) throw new Error('USDC payment not found (Transfer to treasury missing)')
    return { method: 'USDC' }
  }

  throw new Error('Payment tx is not to TREASURY (ETH) or BASE_USDC (USDC)')
}

/* =========================
   Send reward on Arc
========================= */
async function sendArcUsdc({ to, amount }) {
  if (!ARC_RPC_URL) throw new Error('Missing ARC_RPC_URL')
  if (!ARC_USDC) throw new Error('Missing ARC_USDC')
  if (!ARC_TREASURY_PRIVATE_KEY) throw new Error('Missing ARC_TREASURY_PRIVATE_KEY')

  const chain = await getArcChain()

  // ✅ allow key without 0x
  const pk = normalizePrivKey(ARC_TREASURY_PRIVATE_KEY)
  const account = privateKeyToAccount(pk)

  const arcPublic = createPublicClient({
    chain,
    transport: http(ARC_RPC_URL),
  })

  const arcWallet = createWalletClient({
    chain,
    account,
    transport: http(ARC_RPC_URL),
  })

  const hash = await arcWallet.writeContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, parseUnits(String(amount), 6)],
  })

  const rc = await arcPublic.waitForTransactionReceipt({ hash, confirmations: 1 })
  if (!rc || rc.status !== 'success') throw new Error('Arc reward tx failed')

  return hash
}

/* =========================
   Route
========================= */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))

    const userAddress = normAddr(body.userAddress)
    const txHash = normHash(body.txHash)
    const twitterUsername = String(body.twitterUsername || '').trim().replace(/^@/, '')

    if (!userAddress || !userAddress.startsWith('0x') || userAddress.length !== 42) {
      return json({ ok: false, error: 'Invalid userAddress' }, { status: 400 })
    }
    if (!txHash || !txHash.startsWith('0x') || txHash.length < 20) {
      return json({ ok: false, error: 'Invalid txHash' }, { status: 400 })
    }
    if (twitterUsername.length < 2) {
      return json({ ok: false, error: 'twitterUsername required' }, { status: 400 })
    }

    if (!TREASURY || !BASE_USDC) {
      return json({ ok: false, error: 'Server misconfigured (TREASURY/BASE_USDC missing)' }, { status: 500 })
    }

    // ============================
    // 1) Wallet cooldown (2 hours)
    // ============================
    const now = Math.floor(Date.now() / 1000)
    const walletKey = `arc:claim:last:${userAddress}`
    const last = Number((await kvGet(walletKey)) || 0)

    if (last && now - last < COOLDOWN_SEC) {
      const remain = COOLDOWN_SEC - (now - last)
      return json(
        {
          ok: false,
          error: `Rate limited: 1 claim per 2 hours. Try again in ${fmtWait(remain)}.`,
          retryAfterSec: remain,
        },
        { status: 429 }
      )
    }

    // ==================================
    // 2) txHash single-use (anti replay)
    // ==================================
    const txKey = `arc:claim:tx:${txHash}`
    const txUsedBy = await kvGet(txKey)
    if (txUsedBy) {
      return json(
        {
          ok: true,
          alreadyClaimed: true,
          arcTxHash: null,
          note: 'This payment txHash was already used to claim.',
        },
        { status: 200 }
      )
    }

    // ============================
    // 3) Verify payment on Base
    // ============================
    await verifyBasePayment({ userAddress, txHash })

    // ============================
    // 4) Send reward on Arc
    // ============================
    const arcTxHash = await sendArcUsdc({ to: userAddress, amount: REWARD_USDC })

    // ============================
    // 5) Store records
    // ============================
    await kvSet(walletKey, String(now), COOLDOWN_SEC + 120)
    await kvSet(txKey, userAddress, 7 * 24 * 3600)

    return json({
      ok: true,
      alreadyClaimed: false,
      arcTxHash,
      arcExplorerUrl: `https://testnet.arcscan.app/tx/${arcTxHash}`,
    })
  } catch (e) {
    return json({ ok: false, error: e?.message || 'Server error' }, { status: 500 })
  }
}
