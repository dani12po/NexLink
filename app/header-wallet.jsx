'use client'

import React from 'react'

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ''
}

export default function HeaderWallet() {
  const [mounted, setMounted] = React.useState(false)
  const [address, setAddress] = React.useState(null)

  React.useEffect(() => {
    setMounted(true)
    // @ts-ignore
    const eth = typeof window !== 'undefined' ? window.ethereum : null
    if (!eth) return

    const sync = async () => {
      try {
        const accs = await eth.request({ method: 'eth_accounts' })
        setAddress(accs?.[0] || null)
      } catch {
        setAddress(null)
      }
    }

    const onAccounts = (accs) => setAddress(accs?.[0] || null)

    sync()
    eth.on?.('accountsChanged', onAccounts)

    return () => {
      eth.removeListener?.('accountsChanged', onAccounts)
    }
  }, [])

  const connect = async () => {
    // @ts-ignore
    const eth = typeof window !== 'undefined' ? window.ethereum : null
    if (!eth) {
      alert('Wallet not detected. Install/enable MetaMask first.')
      return
    }
    await eth.request({ method: 'eth_requestAccounts' })
    const accs = await eth.request({ method: 'eth_accounts' })
    setAddress(accs?.[0] || null)
  }

  // biar nggak hydration mismatch
  if (!mounted) {
    return (
      <div className="px-4 py-2 rounded-xl border border-zinc-800 bg-white/5 text-sm text-zinc-300">
        …
      </div>
    )
  }

  return address ? (
    <div className="px-4 py-2 rounded-xl border border-zinc-800 bg-white/5 text-sm text-zinc-200">
      {shortAddr(address)}
    </div>
  ) : (
    <button
      type="button"
      onClick={connect}
      className="px-4 py-2 rounded-xl border border-zinc-800 bg-white/10 hover:bg-white/15 text-sm"
    >
      Connect Wallet
    </button>
  )
}
