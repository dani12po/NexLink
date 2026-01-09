# Arc Claim Gate (Next.js + Vercel)

A gated faucet site:

1) User pays **0.1 USDC on Base** to your treasury address  
2) User logs in with **X (OAuth2 + PKCE)**  
3) User follows your target account (X API `POST /2/users/{id}/following`)  
4) Server sends **REWARD_USDC on Arc Testnet** to the same wallet address

> Notes:
> - Arc uses **USDC as the gas token** — your Arc treasury wallet must hold enough testnet USDC for gas + rewards.
> - X API access level/tier may affect follow endpoints. If your app is not allowed to use `follows.write`, the follow step will fail. 

## Tech
- Next.js (App Router)
- Tailwind CSS
- Server-side verification on Base using `viem`
- Server-side sending on Arc using `viem`
- Session + state stored in **Vercel KV** (recommended). Falls back to in-memory Map for local dev.

## Built-in anti-abuse
- **1 claim per wallet**
- **1 claim per X account** (X user id)
- **Rate limiting per IP** (configurable via env)
- Faucet balance check with a **friendly “faucet empty” message** instead of a hard failure

---

## 1) Install

```bash
npm i
```

## 2) Configure env

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill:
- `APP_URL`
- `TREASURY_BASE_ADDRESS`
- `BASE_RPC_URL`
- `ARC_TREASURY_PRIVATE_KEY`
- `X_CLIENT_ID`, `X_CLIENT_SECRET`
- `X_TARGET_USER_ID`
- (Recommended) `KV_REST_API_URL`, `KV_REST_API_TOKEN`

Optional:
- `REWARD_USDC` (server-side reward amount)
- `NEXT_PUBLIC_REWARD_USDC` (UI display)
- `ARC_GAS_BUFFER_USDC` (keeps a small buffer because Arc gas is paid in USDC)
- `NEXT_PUBLIC_ADMIN_CONTACT` / `NEXT_PUBLIC_ADMIN_CONTACT_URL` (shown when faucet is empty)
- Rate limit envs (`RL_*`)

### X OAuth settings
In X Developer Portal, set the callback URL to:

- Local: `http://localhost:3000/api/x/callback`
- Production: `https://YOUR_DOMAIN/api/x/callback`

Scopes used by default:
`tweet.read users.read follows.write offline.access`

## 3) Run locally

```bash
npm run dev
```

Open: http://localhost:3000

---

## Deploy to Vercel

1) Push to GitHub
2) Import to Vercel
3) Set environment variables in Vercel Project Settings
4) (Recommended) Create **Vercel KV** and add `KV_REST_API_URL` + `KV_REST_API_TOKEN`

---

## Security & Anti-abuse
Already included:
- rate limit by IP
- one claim per wallet
- one claim per X account

Still recommended:
- Require N confirmations on Base before verifying
- Add server-side blocklist for known abusers
- Log all claims to a database

---

## Troubleshooting
- **“X follow failed”**: your X app likely lacks required permission/tier for `follows.write`.
- **Arc tx fails**: your Arc treasury wallet may be out of testnet USDC (gas).
- **Payment not verified**: ensure user paid USDC (native) on Base to the correct treasury address.

