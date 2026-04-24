# Arc DApp

Fullstack DApp di atas Arc Network yang mengintegrasikan Circle USDC, Bridge, Swap, dan Nanopayment x402.

## Fitur

| Fitur | Deskripsi |
|-------|-----------|
| 🌉 **Bridge** | Bridge USDC Sepolia ↔ Arc Testnet via Circle CCTP V2 |
| 🔄 **Swap** | Swap USDC ↔ EURC di Arc Testnet via StableFX |
| ⚡ **Nanopayment** | Kirim micropayment USDC via x402 HTTP protocol |
| 🚰 **Faucet** | Claim USDC testnet (pay-to-claim + free claim) |
| 💰 **Balance** | Real-time USDC balance di Arc Testnet |
| 📜 **History** | Transaction history dari ArcScan |

## Tech Stack

- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Web3**: Viem + Wagmi v3
- **Payment**: x402 HTTP payment protocol
- **Bridge**: Circle CCTP V2 (manual implementation)
- **Storage**: Supabase / Vercel KV

## Network Info

| Parameter | Value |
|-----------|-------|
| Network | Arc Testnet |
| Chain ID | 5042002 |
| RPC | https://rpc.testnet.arc.network |
| Currency | USDC (native gas token) |
| Explorer | https://testnet.arcscan.app |
| Faucet | https://faucet.circle.com |

## Contract Addresses (Arc Testnet)

Sumber: [docs.arc.network/arc/references/contract-addresses](https://docs.arc.network/arc/references/contract-addresses)

| Contract | Address |
|----------|---------|
| USDC | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| USYC | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` |
| Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| StableFX Escrow | `0x867650F5eAe8df91445971f14d89fd84F0C9a9f8` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
# Edit .env.local dengan nilai yang sesuai
```

### 3. Jalankan development server

```bash
npm run dev
```

### 4. Buka di browser

- **Faucet**: http://localhost:3000
- **Bridge**: http://localhost:3000/bridge  
- **DApp (Bridge+Swap+Nanopayment)**: http://localhost:3000/dapp

## Deploy ke Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables di Vercel dashboard
# atau via CLI:
vercel env add ARC_TREASURY_PRIVATE_KEY
vercel env add X402_RECEIVER_ADDRESS
# ... dst
```

## Halaman & Routes

| Route | Deskripsi |
|-------|-----------|
| `/` | Faucet utama (pay-to-claim + free claim) |
| `/bridge` | Bridge USDC Sepolia ↔ Arc (standalone) |
| `/dapp` | DApp lengkap: Bridge + Swap + Nanopayment |
| `/api/claim` | API: claim reward setelah payment |
| `/api/free-claim` | API: free claim dengan cooldown |
| `/api/bridge/attestation` | API: proxy attestation Circle Iris |
| `/api/x402/pay` | API: demo endpoint dengan x402 paywall |

## x402 Nanopayment

x402 adalah HTTP payment protocol yang menggunakan status code 402 "Payment Required".

**Flow:**
1. Client request ke endpoint
2. Server return `402` + payment requirements (amount, recipient, network)
3. Client sign EIP-3009 `TransferWithAuthorization`
4. Client retry dengan `X-PAYMENT` header
5. Server verifikasi signature → eksekusi transfer → return konten

**Referensi:**
- [x402.org](https://x402.org)
- [Circle Nanopayments](https://developers.circle.com/gateway/nanopayments)
- [Thirdweb x402 Facilitator](https://portal.thirdweb.com/payments/x402/facilitator)

## Bridge (CCTP V2)

Bridge menggunakan Circle CCTP V2 secara manual — semua transaksi di-sign langsung dari wallet user.

**Flow Sepolia → Arc:**
1. Approve USDC ke TokenMessenger di Sepolia
2. `depositForBurn` → emit `MessageSent` event
3. Poll attestation dari Circle Iris API
4. `receiveMessage` di Arc Testnet → USDC masuk ke wallet

**⚠️ Catatan:** Contract address CCTP di Arc Testnet perlu dikonfirmasi di [docs.arc.network](https://docs.arc.network/arc/references/contract-addresses). Set via env jika berbeda:
```
NEXT_PUBLIC_ARC_TOKEN_MESSENGER=0x...
NEXT_PUBLIC_ARC_MESSAGE_TRANSMITTER=0x...
```

## Struktur Folder

```
├── app/
│   ├── page.jsx              # Faucet utama
│   ├── bridge/page.tsx       # Bridge standalone
│   ├── dapp/page.tsx         # DApp lengkap
│   ├── claim/page.jsx        # Claim page
│   └── api/
│       ├── claim/            # Claim API
│       ├── free-claim/       # Free claim API
│       ├── bridge/
│       │   └── attestation/  # CCTP attestation proxy
│       └── x402/
│           └── pay/          # x402 demo endpoint
├── components/
│   ├── WalletButton.tsx      # Wallet connect
│   ├── BalanceBar.tsx        # USDC balance bar
│   ├── BridgePanel.tsx       # Bridge UI
│   ├── SwapPanel.tsx         # Swap UI
│   ├── NanopaymentPanel.tsx  # x402 payment UI
│   └── TxHistory.tsx         # Transaction history
└── lib/
    ├── arcChain.ts           # Chain config & contract addresses
    ├── wagmiConfig.ts        # Wagmi configuration
    ├── x402Client.ts         # x402 client helper
    └── ...
```
