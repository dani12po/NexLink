import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Arc Faucet Claim",
  description: "Pay on Base → Follow on X → Receive 10 USDC on Arc Testnet",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen">
            <header className="border-b border-zinc-800 bg-zinc-950/70 backdrop-blur">
              <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
                <a href="/" className="font-semibold tracking-tight">
                  Arc Claim Gate
                </a>
                <div className="text-sm text-zinc-400">
                  Testnet rewards • Do not use for production
                </div>
              </div>
            </header>

            <main className="mx-auto max-w-5xl px-4 py-10">
              {children}
            </main>

            <footer className="border-t border-zinc-800 mt-10">
              <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-zinc-500">
                This site sends testnet USDC on Arc after verified steps. No keys are exposed to the browser. | created with ❤️by Danixyz
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
