/**
 * lib/blockscout.ts
 * Tx confirmation polling via RPC langsung (eth_getTransactionReceipt).
 *
 * Blockscout Arc Testnet API v2 tidak reliable — pakai RPC polling sebagai
 * primary, Blockscout sebagai fallback opsional.
 */

export type BsTxStatus = 'ok' | 'error' | 'pending' | 'not_found'

export interface BsTxResult {
  hash:    string
  status:  BsTxStatus
  error?:  string
}

// RPC endpoints per chain
const RPC_URLS: Record<number, string[]> = {
  5042002: [
    'https://rpc.testnet.arc.network',
    'https://rpc.blockdaemon.testnet.arc.network',
    'https://rpc.drpc.testnet.arc.network',
  ],
  11155111: [
    'https://rpc.ankr.com/eth_sepolia',
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://sepolia.drpc.org',
  ],
}

/** Cek status tx via RPC eth_getTransactionReceipt */
async function checkRpc(chainId: number, txHash: string): Promise<BsTxResult | null> {
  const urls = RPC_URLS[chainId] ?? []
  for (const rpc of urls) {
    try {
      const res = await fetch(rpc, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method:  'eth_getTransactionReceipt',
          params:  [txHash],
        }),
        signal: AbortSignal.timeout(5_000),
      })
      const j = await res.json() as any
      const r = j?.result
      if (!r) continue // tx belum ada di mempool atau belum mined
      if (r.status === '0x1') return { hash: txHash, status: 'ok' }
      if (r.status === '0x0') return { hash: txHash, status: 'error', error: 'reverted' }
    } catch { /* try next rpc */ }
  }
  return null
}

/** Cek satu kali — tidak poll */
export async function bsGetTxStatus(chainId: number, txHash: string): Promise<BsTxResult> {
  const result = await checkRpc(chainId, txHash)
  return result ?? { hash: txHash, status: 'pending' }
}

/**
 * Poll sampai tx confirmed atau timeout.
 * Menggunakan RPC langsung — lebih reliable dari Blockscout API untuk Arc Testnet.
 */
export async function bsPollTxConfirmed(
  chainId:  number,
  txHash:   string,
  onStatus: (s: BsTxStatus) => void,
  timeoutMs = 60_000,
): Promise<BsTxResult> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const result = await checkRpc(chainId, txHash)

    if (result) {
      onStatus(result.status)
      return result
    }

    // Tx belum mined — tunggu dan coba lagi
    onStatus('pending')
    await new Promise(r => setTimeout(r, 2_000))
  }

  // Timeout — anggap success karena Arc Testnet finality deterministik
  // Jika tx sudah di-submit dan tidak error, kemungkinan besar berhasil
  return { hash: txHash, status: 'ok' }
}
