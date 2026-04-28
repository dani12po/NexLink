'use client'
/**
 * app/providers.jsx
 * Wrap app dengan WagmiProvider + QueryClient.
 *
 * PENTING: QueryClient HARUS dibuat di dalam useState agar tidak di-share
 * antar request di server (mencegah hydration mismatch).
 */
import { useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/lib/wagmiConfig'

export default function Providers({ children }) {
  // QueryClient dibuat di dalam useState — tidak di-share antar request
  const [queryClient] = useState(
    () => new QueryClient({
      defaultOptions: { queries: { retry: 2, staleTime: 10_000 } },
    })
  )

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
