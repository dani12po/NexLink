import "./globals.css";
import HeaderWallet from "./header-wallet";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata = {
  title: "Arc Claim Gate",
  description: "Pay on Base → Follow on X → Receive USDC on Arc Testnet",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100">
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
            <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
              {/* 2x bigger */}
              <a
                href="/"
                className="text-2xl font-semibold tracking-tight text-zinc-100"
              >
                Arc Claim Gate
              </a>

              {/* Connect wallet on the right */}
              <HeaderWallet />
            </div>
          </header>

          <main className="flex-1">
            <div className="mx-auto max-w-6xl px-4 py-10">{children}</div>
          </main>

          <footer className="border-t border-zinc-800">
            <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-zinc-500 text-center">
              Sends testnet USDC on Arc after verified steps. No keys are exposed to the browser. | created with ❤️ by Danixyz
            </div>
          </footer>
        </div>
        <SpeedInsights />
      </body>
    </html>
  );
}
