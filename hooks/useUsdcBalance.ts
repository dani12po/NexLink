/**
 * hooks/useUsdcBalance.ts
 * Baca balance USDC via viem ERC-20 call langsung.
 *
 * Tidak pakai BridgeKit adapter karena wallet connect via window.ethereum
 * (custom WalletButton), bukan via wagmi — adapter bisa null.
 */
'use client'

import { useState, useCallback, useEffect } from 'react'
import { createPublicClient, http, fallback, formatUnits, erc20Abi } from 'viem'
import { sepolia } from 'viem/chains'
import {
  ARC_USDC, ARC_RPC, ARC_RPC_BACKUP, ARC_RPC_BACKUP2, arcTestnet,
  SEPOLIA_USDC, SEPOLIA_RPC, SEPOLIA_RPC_BACKUP, SEPOLIA_RPC_FALLBACK3,
  BRIDGE_KIT_CHAIN_ARC, BRIDGE_KIT_CHAIN_SEPOLIA,
} from '@/lib/arcChain'

function makeClient(chain: string) {
  if (chain === BRIDGE_KIT_CHAIN_ARC) {
    return createPublicClient({
      chain: arcTestnet as any,
      transport: fallback([http(ARC_RPC), http(ARC_RPC_BACKUP), http(ARC_RPC_BACKUP2)]),
    }) as any
  }
  return createPublicClient({
    chain: sepolia,
    transport: fallback([http(SEPOLIA_RPC), http(SEPOLIA_RPC_BACKUP), http(SEPOLIA_RPC_FALLBACK3)]),
  })
}

function getUsdcAddress(chain: string): `0x${string}` {
  return chain === BRIDGE_KIT_CHAIN_ARC ? ARC_USDC : SEPOLIA_USDC
}

export function useUsdcBalance(
  _adapter:  any,           // tidak dipakai, dipertahankan agar signature kompatibel
  address:   string | null,
  chain:     string,
) {
  const [balance, setBalance] = useState<string>('—')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!address) { setBalance('—'); return }
    setLoading(true)
    try {
      const client = makeClient(chain)
      const raw = await client.readContract({
        address:      getUsdcAddress(chain),
        abi:          erc20Abi,
        functionName: 'balanceOf',
        args:         [address as `0x${string}`],
      })
      setBalance(parseFloat(formatUnits(raw as bigint, 6)).toFixed(4))
    } catch {
      setBalance('—')
    } finally {
      setLoading(false)
    }
  }, [address, chain])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [refresh])

  return { balance, loading, refresh }
}
