'use client'

import React from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/lib/wagmiConfig'

// QueryClient singleton — jangan buat di dalam komponen agar tidak re-create tiap render
const queryClient = new QueryClient()

export default function Providers({ children }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
