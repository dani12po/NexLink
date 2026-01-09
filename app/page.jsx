import StepCard from "@/components/StepCard";

export default function Home() {
  const handle = process.env.NEXT_PUBLIC_X_TARGET_HANDLE || "@iq_dani26";
  const priceLabel = process.env.NEXT_PUBLIC_PAYMENT_LABEL || "0.1 USDC on Base";

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Claim 10 USDC on Arc Testnet
        </h1>
        <p className="text-zinc-300 max-w-2xl">
          Simple gated faucet flow: pay a small amount on Base, connect your X account, follow{handle},
          then receive <span className="font-semibold">10 USDC</span> on Arc Testnet. 
        </p>

        <div className="flex gap-3 pt-2">
          <a
            className="inline-flex items-center justify-center rounded-xl bg-white text-zinc-900 px-4 py-2 text-sm font-semibold hover:bg-zinc-200 transition"
            href="/claim"
          >
            Open Claim Page
          </a>
          <a
            className="inline-flex items-center justify-center rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-900 transition"
            href="#how"
          >
            How it works
          </a>
        </div>
      </div>

      <div id="how" className="grid gap-4 sm:grid-cols-2">
        <StepCard
          step="1"
          title="Pay on Base"
          desc={`Send ${priceLabel} to the treasury address from your wallet (Base mainnet).`}
        />
        <StepCard
          step="2"
          title="Login with X"
          desc="Sign in to X using OAuth2 (PKCE). Your access token stays server-side."
        />
        <StepCard
          step="3"
          title={`Follow ${handle}`}
          desc="We request permission to follow the target account using the X API."
        />
        <StepCard
          step="4"
          title="Receive Arc testnet USDC"
          desc="After verification, the server sends 10 USDC to your same wallet address on Arc Testnet."
        />
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-300">
        <div className="font-semibold text-zinc-100 mb-2">Notes</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>This is a testnet reward. It has no real-world value.</li>
          <li>If X API access is not enabled for your app tier, follow verification may fail.</li>
          <li>Gas on Arc is paid in USDC; the treasury wallet must have enough testnet USDC.</li>
        </ul>
      </div>
    </div>
  );
}
