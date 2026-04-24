/**
 * lib/validation.ts
 * Input validation helpers — wallet address, amount, private key
 */

/** Validasi dan normalize wallet address */
export function validateWalletAddress(addr: string): string {
  if (!addr || typeof addr !== 'string') throw new Error('Wallet address diperlukan')
  const clean = addr.trim().toLowerCase()
  if (!/^0x[a-f0-9]{40}$/.test(clean)) throw new Error('Format wallet address tidak valid')
  if (clean === '0x' + '0'.repeat(40)) throw new Error('Zero address tidak diizinkan')
  return clean
}

/** Validasi amount dan konversi ke bigint (6 decimals USDC) */
export function validateAmount(amount: string, min = 0.000001, max = 1_000_000): bigint {
  const n = parseFloat(amount)
  if (isNaN(n) || !isFinite(n)) throw new Error('Amount tidak valid')
  if (n < min) throw new Error(`Amount minimal ${min} USDC`)
  if (n > max) throw new Error(`Amount maksimal ${max} USDC`)
  return BigInt(Math.round(n * 1_000_000))
}

/** Validasi dan normalize private key */
export function validatePrivateKey(pk: string | undefined): `0x${string}` {
  if (!pk) throw new Error('Private key tidak di-set')

  const placeholders = ['GANTI_DENGAN_PRIVATE_KEY_BARU', 'your_private_key_here', 'xxx']
  if (placeholders.some(p => pk.includes(p))) {
    throw new Error('Private key masih placeholder')
  }

  const clean = pk.trim().replace(/^['"]|['"]$/g, '')
  const hex = clean.startsWith('0x') ? clean : `0x${clean}`

  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`Format private key salah (expected 64 hex chars, got ${clean.length})`)
  }
  if (hex === '0x' + '0'.repeat(64)) {
    throw new Error('Private key tidak boleh all-zeros')
  }

  return hex as `0x${string}`
}
