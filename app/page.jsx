'use client'

import React from 'react'
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther } from 'viem'

const RECEIVER = process.env.NEXT_PUBLIC_PAYMENT_RECEIVER
const PAY_ETH = process.env.NEXT_PUBLIC_PAY_ETH ?? '0.00005' // contoh, sesuaikan

export default function Page() {
  const { address, isConnected } = useAccount()

  // --- payment tx ---
  const { data: hash, sendTransaction, isPending: isSending } = useSendTransaction()

  // tunggu 1 konfirmasi
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({
    hash,
    confirmations: 1,
    query: { enabled: Boolean(hash) },
  })

  // --- gate states ---
  const [cooldown, setCooldown] = React.useState(0)
  const [paid, setPaid] = React.useState(false)
  const [twitterEnabled, setTwitterEnabled] = React.useState(false)

  // (opsional) biar kalau refresh gak hilang
  React.useEffect(() => {
    const saved = localStorage.getItem('payTxHash')
    if (saved && !hash) {
      // kamu bisa set state khusus buat “rehydrate” hash jika pakai wagmi store,
      // paling simpel: panggil API verify tx hash di sini.
    }
  }, [hash])

  // saat tx confirmed -> mark paid -> mulai countdown 10 detik
  React.useEffect(() => {
    if (!isConfirmed) return

    setPaid(true)
    setTwitterEnabled(false)
    setCooldown(10)

    // simpan hash supaya gak hilang
    if (hash) localStorage.setItem('payTxHash', hash)

    // OPTIONAL tapi recommended:
    // setelah confirmed, panggil backend verify biar server tau user ini “paid”
    ;(async () => {
      try {
        await fetch('/api/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash: hash, userAddress: address }),
        })
      } catch (e) {
        // kalau gagal, UI tetap jalan, tapi claim bisa kamu blok di server
      }
    })()
  }, [isConfirmed, hash, address])

  // countdown tick
  React.useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown((s) => s - 1), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  React.useEffect(() => {
    if (cooldown === 0 && paid) setTwitterEnabled(true)
  }, [cooldown, paid])

  const onPay = () => {
    if (!RECEIVER) return alert('Missing NEXT_PUBLIC_PAYMENT_RECEIVER')
    sendTransaction({
      to: RECEIVER,
      value: parseEther(PAY_ETH),
    })
  }

  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <h2>Arc Faucet</h2>

      {!isConnected && (
        <p>Connect wallet dulu.</p>
      )}

      {isConnected && !paid && (
        <button onClick={onPay} disabled={isSending || isConfirming}>
          {isSending ? 'Confirm di wallet...' : isConfirming ? 'Menunggu konfirmasi onchain...' : `Pay ${PAY_ETH} ETH`}
        </button>
      )}

      {confirmError && (
        <p style={{ color: 'red' }}>
          Payment gagal / revert: {confirmError.message}
        </p>
      )}

      {paid && cooldown > 0 && (
        <div style={{ marginTop: 16 }}>
          <p>✅ Payment confirmed.</p>
          <p>Aktifkan Twitter dalam: <b>{cooldown}s</b></p>
        </div>
      )}

      {/* TOMBOL TWITTER baru muncul setelah countdown selesai */}
      {twitterEnabled && (
        <div style={{ marginTop: 16 }}>
          <button onClick={() => (window.location.href = '/api/x/login')}>
            Connect Twitter
          </button>

          {/* setelah login sukses, tampilkan tombol follow */}
          {/* <button onClick={() => fetch('/api/x/follow', { method: 'POST' })}>Follow @yourhandle</button> */}
        </div>
      )}

      {/* Claim hanya aktif jika paid + twitter done */}
      {/* <button disabled={!paid || !twitterDone}>Claim Faucet</button> */}
    </div>
  )
}
