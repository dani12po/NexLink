/**
 * lib/bridgeKitSingleton.ts
 * Shared BridgeKit singleton — satu instance untuk seluruh app.
 * Dipakai oleh: hooks/useBridge.ts, hooks/useUsdcBalance.ts
 */
import { BridgeKit } from '@circle-fin/bridge-kit'

let _kit: BridgeKit | null = null

export function getBridgeKit(): BridgeKit {
  if (!_kit) {
    const kitKey =
      process.env.NEXT_PUBLIC_KIT_KEY ??
      process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY ??
      ''

    if (!kitKey && process.env.NODE_ENV === 'development') {
      console.warn(
        '[BridgeKit] NEXT_PUBLIC_KIT_KEY tidak di-set.\n' +
        'BridgeKit berjalan tanpa auth — rate limit sangat ketat di sandbox.\n' +
        'Tambahkan NEXT_PUBLIC_KIT_KEY=KIT_KEY:xxx:xxx ke .env.local',
      )
    }

    try {
      _kit = new BridgeKit({ kitKey } as any)
    } catch (e) {
      try {
        _kit = new BridgeKit({ apiKey: kitKey } as any)
      } catch {
        _kit = new BridgeKit({} as any)
        console.error('[BridgeKit] Gagal inisialisasi dengan kitKey/apiKey:', e)
      }
    }
  }
  return _kit
}

export function resetBridgeKit(): void {
  _kit = null
}
