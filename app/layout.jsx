import "./globals.css";
import { Suspense } from "react";
import HeaderWallet from "./header-wallet";
import HeaderTabs from "./header-tabs";
import { WalletProvider } from "@/lib/walletContext";

export const metadata = {
  title: "NEXLINK",
  description: "Bridge · Swap · Nanopayment on Arc Network",
};

function NexlinkIcon({ size = 28 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="28" height="28" rx="6" fill="url(#nx-grad)" />
      <text
        x="14"
        y="20"
        textAnchor="middle"
        fontSize="16"
        fontWeight="700"
        fontFamily="Space Grotesk, sans-serif"
        fill="#ffffff"
      >
        N
      </text>
      <defs>
        <linearGradient id="nx-grad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00D4AA" />
          <stop offset="100%" stopColor="#00A3FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function NexlinkWordmark() {
  return (
    <span
      className="text-xl font-bold tracking-tight select-none"
      style={{ fontFamily: "'Space Grotesk', sans-serif" }}
    >
      <span className="text-white">NEX</span>
      <span style={{ color: "#00D4AA" }}>LINK</span>
    </span>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-[#0a0a0a] text-zinc-100">
        <div className="min-h-screen flex flex-col">

          {/* ── Single header ── */}
          <header
            className="sticky top-0 z-50 backdrop-blur-md"
            style={{
              background: "rgba(10,10,10,0.88)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              height: "56px",
            }}
          >
            {/*
              3-column layout:
              LEFT  (flex:1) — logo + wordmark
              CENTER (absolute, translateX -50%) — Bridge | Swap tabs
              RIGHT (flex:1) — wallet button
            */}
            <div
              className="mx-auto max-w-6xl px-4 h-full"
              style={{ display: "flex", alignItems: "center", position: "relative" }}
            >
              {/* LEFT */}
              <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
                <a
                  href="/"
                  className="flex items-center gap-2 transition-transform duration-150 hover:scale-[1.02]"
                  aria-label="NEXLINK home"
                >
                  <NexlinkIcon size={28} />
                  <NexlinkWordmark />
                </a>
              </div>

              {/* CENTER — absolute so it's truly centered regardless of left/right widths */}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Suspense fallback={null}>
                  <HeaderTabs />
                </Suspense>
              </div>

              {/* RIGHT */}
              <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                <HeaderWallet />
              </div>
            </div>
          </header>

          <main className="flex-1">
            <div className="mx-auto max-w-6xl px-4 py-10">
              <WalletProvider>
                {children}
              </WalletProvider>
            </div>
          </main>

          <footer style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div
              className="mx-auto max-w-6xl px-4 py-6 text-xs text-center"
              style={{ color: "rgba(255,255,255,0.3)" }}
            >
              Sends testnet USDC on Arc after verified steps. No keys are exposed to the browser. | created with ❤️ by Danixyz
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
