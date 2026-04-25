/**
 * lib/errors.ts
 * Standarisasi error messages untuk BridgeKit, Viem, dan wallet errors.
 * Ref: https://developers.circle.com/llms-full.txt
 */

export function parseCircleError(e: unknown): string {
  if (!e || typeof e !== 'object') return String(e ?? 'Error tidak diketahui')
  const err = e as any

  // BridgeKit errors
  if (err?.code === 'INSUFFICIENT_FUNDS')   return 'Saldo USDC tidak cukup'
  if (err?.code === 'CHAIN_NOT_SUPPORTED')  return 'Chain tidak didukung BridgeKit'
  if (err?.code === 'BRIDGE_TIMEOUT')       return 'Bridge timeout — coba retry'
  if (err?.code === 'ATTESTATION_FAILED')   return 'Attestation Circle gagal — coba lagi'

  // Viem/wallet errors
  if (err?.code === 4001)   return 'Transaksi ditolak user'
  if (err?.code === -32603) return 'RPC error — coba ganti network'

  if (err?.shortMessage) return err.shortMessage

  const msg: string = err?.message ?? ''
  if (msg.includes('nonce'))              return 'Nonce error — refresh halaman'
  if (msg.includes('gas'))               return 'Gas estimation gagal — coba lagi'
  if (msg.includes('insufficient'))      return 'Saldo tidak cukup'
  if (msg.includes('user rejected'))     return 'Transaksi ditolak user'
  if (msg.includes('timeout') || msg.includes('Timed out')) return 'Timeout — coba lagi'
  if (msg.includes('network'))           return 'Network error — periksa koneksi'

  return msg || 'Error tidak diketahui'
}
