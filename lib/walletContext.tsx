'use client'
/**
 * lib/walletContext.tsx
 * Shared wallet state — sync antar semua komponen
 */
import React, { createContext, useContext } from 'react'
import { useWallet } from '@/components/WalletButton'

const WalletContext = createContext<ReturnType<typeof useWallet> | null>(null)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet()
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>
}

export function useSharedWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useSharedWallet must be used inside WalletProvider')
  return ctx
}
