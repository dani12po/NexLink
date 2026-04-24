/**
 * lib/evmProvider.ts
 * Safe EVM wallet provider detection — EIP-6963 first, fallback to legacy window.ethereum
 *
 * EIP-6963 (Multi Injected Provider Discovery) mencegah konflik antar extension wallet.
 * Tidak pernah memodifikasi atau menimpa window.ethereum.
 */

export interface EIP6963ProviderInfo {
  uuid: string
  name: string
  icon: string
  rdns: string
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo
  provider: any
}

// Cache provider yang sudah ditemukan via EIP-6963
let _eip6963Providers: EIP6963ProviderDetail[] = []
let _eip6963Initialized = false

function initEIP6963() {
  if (_eip6963Initialized || typeof window === 'undefined') return
  _eip6963Initialized = true

  window.addEventListener('eip6963:announceProvider', (event: any) => {
    const detail = event.detail as EIP6963ProviderDetail
    if (!detail?.provider || !detail?.info?.uuid) return
    // Deduplicate by UUID
    const exists = _eip6963Providers.find(p => p.info.uuid === detail.info.uuid)
    if (!exists) {
      _eip6963Providers.push(detail)
    }
  })

  // Request existing providers to announce themselves
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

/**
 * Dapatkan semua EVM providers yang tersedia (EIP-6963)
 */
export function getEIP6963Providers(): EIP6963ProviderDetail[] {
  initEIP6963()
  return _eip6963Providers
}

/**
 * Dapatkan provider EVM yang aktif.
 * Priority: EIP-6963 first → named providers → window.ethereum (legacy)
 *
 * TIDAK pernah memodifikasi window.ethereum atau global state manapun.
 */
export function getEvmProvider(): any {
  if (typeof window === 'undefined') return null

  // EIP-6963: gunakan provider pertama yang ditemukan
  initEIP6963()
  if (_eip6963Providers.length > 0) {
    return _eip6963Providers[0].provider
  }

  const w = window as any

  // Legacy fallback — urutan dari yang paling spesifik
  if (w.okxwallet) return w.okxwallet
  if (w.coinbaseWalletExtension) return w.coinbaseWalletExtension
  if (w.trustwallet) return w.trustwallet
  if (w.braveEthereum) return w.braveEthereum

  // window.ethereum terakhir karena bisa di-override oleh wallet manapun
  if (w.ethereum) return w.ethereum

  return null
}

export function hasEvmProvider(): boolean {
  return getEvmProvider() !== null
}

export const NO_WALLET_MSG =
  'No EVM wallet detected. Please install MetaMask, OKX Wallet, Rabby, or any EIP-1193 compatible wallet.'
