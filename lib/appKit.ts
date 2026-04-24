/**
 * lib/appKit.ts
 * Singleton Arc App Kit instance
 * Ref: https://docs.arc.network/app-kit
 */
import { AppKit } from '@circle-fin/app-kit'

let _kit: AppKit | null = null

export function getAppKit(): AppKit {
  if (!_kit) {
    _kit = new AppKit()
  }
  return _kit
}
