/**
 * lib/evmProvider.ts
 * EVM wallet provider detection — support EIP-6963 (multi-wallet) + EIP-1193 fallback.
 *
 * EIP-6963: standar modern untuk detect multiple injected wallets
 * (MetaMask, Rabby, OKX, Trust, Coinbase, dll) tanpa konflik window.ethereum.
 */
export const NO_WALLET_MSG = 'Wallet tidak ditemukan. Install MetaMask, Rabby, atau OKX Wallet.'

export interface WalletProvider {
  info: {
    uuid:  string
    name:  string
    icon:  string   // data URI
    rdns:  string   // e.g. 'io.metamask', 'xyz.rabby'
  }
  provider: any    // EIP-1193 provider
}

// Registry wallet yang terdeteksi via EIP-6963
let _eip6963Providers: WalletProvider[] = []
let _eip6963Initialized = false

/**
 * Inisialisasi EIP-6963 listener — panggil sekali saat app mount.
 * Mengumpulkan semua wallet yang announce diri.
 */
export function initEIP6963(): () => void {
  if (typeof window === 'undefined') return () => {}

  const onAnnounce = (event: any) => {
    const detail = event.detail as WalletProvider
    if (!detail?.info?.uuid) return
    // Hindari duplikat
    const exists = _eip6963Providers.some(p => p.info.uuid === detail.info.uuid)
    if (!exists) _eip6963Providers = [..._eip6963Providers, detail]
  }

  window.addEventListener('eip6963:announceProvider', onAnnounce)
  // Request semua wallet announce diri
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  _eip6963Initialized = true

  return () => window.removeEventListener('eip6963:announceProvider', onAnnounce)
}

/** Ambil semua wallet yang terdeteksi via EIP-6963 */
export function getEIP6963Providers(): WalletProvider[] {
  return _eip6963Providers
}

/**
 * Ambil provider EIP-1193 terbaik yang tersedia.
 * Urutan: EIP-6963 first → window.ethereum.providers[0] → window.ethereum
 */
export function getEvmProvider(): any {
  if (typeof window === 'undefined') return null

  // EIP-6963: ambil provider pertama yang announce
  if (_eip6963Providers.length > 0) return _eip6963Providers[0].provider

  // Fallback: window.ethereum (EIP-1193 lama)
  const eth = (window as any).ethereum
  if (!eth) return null
  if (Array.isArray(eth.providers) && eth.providers.length > 0) return eth.providers[0]
  return eth
}

/**
 * Ambil provider berdasarkan RDNS (reverse DNS identifier).
 * Contoh: 'io.metamask', 'xyz.rabby', 'com.okex.wallet'
 */
export function getProviderByRdns(rdns: string): any | null {
  const found = _eip6963Providers.find(p => p.info.rdns === rdns)
  return found?.provider ?? null
}

export async function requestEvmAccounts(): Promise<string | null> {
  const eth = getEvmProvider()
  if (!eth) return null
  try {
    const accs: string[] = await eth.request({ method: 'eth_requestAccounts' })
    return accs?.[0] ?? null
  } catch {
    return null
  }
}

export async function getConnectedAccounts(): Promise<string[]> {
  const eth = getEvmProvider()
  if (!eth) return []
  try {
    return await eth.request({ method: 'eth_accounts' })
  } catch {
    return []
  }
}
