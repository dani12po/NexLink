/**
 * lib/bridgeKitSingleton.ts
 * Shared AppKit singleton — satu instance untuk seluruh app.
 * Menggunakan @circle-fin/app-kit sesuai docs resmi Arc Network.
 * Ref: https://docs.arc.network/app-kit/quickstarts/bridge-tokens-across-blockchains#viem
 *
 * Dipakai oleh: hooks/useBridge.ts
 */
import { AppKit } from '@circle-fin/app-kit'

let _kit: AppKit | null = null

export function getAppKit(): AppKit {
  if (!_kit) {
    // AppKit tidak butuh API key untuk bridge — cukup inisialisasi kosong
    _kit = new AppKit()
  }
  return _kit
}

export function resetAppKit(): void {
  _kit = null
}

// Backward compat alias
export const getBridgeKit = getAppKit
export const resetBridgeKit = resetAppKit
