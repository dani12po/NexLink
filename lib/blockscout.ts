/**
 * lib/blockscout.ts
 * Blockscout API helper untuk deteksi transaksi dan gas price.
 * Ref: https://dev.blockscout.com
 * API: https://api.blockscout.com/{chain_id}/api/v2/
 */

// Chain ID → Blockscout base URL
const BLOCKSCOUT_BASE: Record<number, string> = {
  5042002:  'https://api.blockscout.com/5042002', // Arc Testnet
  11155111: 'https://api.blockscout.com/11155111', // Ethereum Sepolia
}

const API_KEY = process.env.NEXT_PUBLIC_BLOCKSCOUT_API_KEY ?? ''

function bsUrl(chainId: number, path: string): string {
  const base = BLOCKSCOUT_BASE[chainId]
  if (!base) throw new Error(`Blockscout tidak support chain ${chainId}`)
  const sep = path.includes('?') ? '&' : '?'
  return `${base}/api/v2${path}${API_KEY ? `${sep}apikey=${API_KEY}` : ''}`
}

export interface BsTxStatus {
  hash:        string
  status:      'ok' | 'error' | 'pending' | 'not_found'
  gasUsed?:    string
  gasPrice?:   string   // wei
  gasFeeUsdc?: string   // estimasi dalam USDC (6 decimals)
  blockNumber?: number
  error?:      string
}

/**
 * Cek status transaksi via Blockscout API.
 * Return status: 'ok' | 'error' | 'pending' | 'not_found'
 */
export async function bsGetTxStatus(chainId: number, txHash: string): Promise<BsTxStatus> {
  try {
    const url = bsUrl(chainId, `/transactions/${txHash}`)
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    })

    if (res.status === 404) return { hash: txHash, status: 'not_found' }
    if (!res.ok) return { hash: txHash, status: 'pending' }

    const data = await res.json() as any

    // Blockscout v2 response: { status: 'ok'|'error', result: {...} }
    // atau langsung { hash, status, gas_used, gas_price, ... }
    const tx = data?.result ?? data

    if (!tx || !tx.hash) return { hash: txHash, status: 'not_found' }

    // status: null = pending, '1' atau 'ok' = success, '0' atau 'error' = failed
    const rawStatus = tx.status ?? tx.result
    let status: BsTxStatus['status'] = 'pending'
    if (rawStatus === '1' || rawStatus === 'ok' || rawStatus === true) status = 'ok'
    else if (rawStatus === '0' || rawStatus === 'error' || rawStatus === false) status = 'error'
    else if (tx.block_number || tx.blockNumber) status = 'ok' // ada block = confirmed

    const gasUsed  = tx.gas_used  ?? tx.gasUsed  ?? undefined
    const gasPrice = tx.gas_price ?? tx.gasPrice ?? undefined

    return {
      hash: txHash,
      status,
      gasUsed:    gasUsed  ? String(gasUsed)  : undefined,
      gasPrice:   gasPrice ? String(gasPrice) : undefined,
      blockNumber: tx.block_number ?? tx.blockNumber ?? undefined,
      error:      tx.revert_reason ?? tx.error ?? undefined,
    }
  } catch {
    return { hash: txHash, status: 'pending' }
  }
}

/**
 * Ambil gas price terkini dari Blockscout stats.
 * Return dalam wei (string) atau null jika gagal.
 */
export async function bsGetGasPrice(chainId: number): Promise<{ slow: string; average: string; fast: string } | null> {
  try {
    const url = bsUrl(chainId, '/stats')
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json() as any

    // Blockscout stats response: { gas_prices: { slow, average, fast } }
    const gp = data?.gas_prices ?? data?.result?.gas_prices
    if (!gp) return null

    // gas_prices dalam Gwei — convert ke wei
    const toWei = (gwei: number | string) => String(Math.round(parseFloat(String(gwei)) * 1e9))

    return {
      slow:    toWei(gp.slow    ?? gp.SafeGasPrice    ?? 20),
      average: toWei(gp.average ?? gp.ProposeGasPrice ?? 25),
      fast:    toWei(gp.fast    ?? gp.FastGasPrice    ?? 30),
    }
  } catch {
    return null
  }
}

/**
 * Poll transaksi via Blockscout sampai confirmed atau timeout.
 * Lebih reliable dari RPC polling karena Blockscout index semua tx.
 */
export async function bsPollTxConfirmed(
  chainId:    number,
  txHash:     string,
  onProgress: (msg: string) => void,
  maxMs = 1_200_000, // 20 menit
  intervalMs = 3_000,
): Promise<BsTxStatus> {
  const deadline = Date.now() + maxMs
  let attempt = 0

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs))
    attempt++

    const result = await bsGetTxStatus(chainId, txHash)

    if (result.status === 'ok') return result
    if (result.status === 'error') {
      throw new Error(`Transaksi reverted: ${result.error ?? txHash}`)
    }

    // Log progress setiap 10 attempt (~30 detik)
    if (attempt % 10 === 0) {
      const elapsed = Math.round((Date.now() - (deadline - maxMs)) / 1_000)
      const statusMsg = result.status === 'not_found'
        ? 'belum terdeteksi di Blockscout'
        : 'pending di mempool'
      onProgress(`Tx ${statusMsg} (${elapsed}s)…`)
    }
  }

  throw new Error(`Timeout menunggu konfirmasi (${Math.round(maxMs / 60_000)} menit). Hash: ${txHash}`)
}
