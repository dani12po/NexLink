import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  parseEther,
  parseUnits,
  erc20Abi,
  getAddress,
  decodeEventLog,
} from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function envAny(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim() !== "") return v;
  }
  return null;
}

function toAddr(x) {
  try {
    return getAddress(x);
  } catch {
    return null;
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const txHash = body?.txHash;
    const userAddress = body?.userAddress;

    if (!txHash) {
      return NextResponse.json({ ok: false, error: "Missing txHash" }, { status: 400 });
    }

    // === ENV (NO PAYMENT_RECEIVER ANYMORE) ===
    const BASE_RPC_URL = envAny("BASE_RPC_URL") || "https://mainnet.base.org";
    const TREASURY = envAny("TREASURY_BASE_ADDRESS", "NEXT_PUBLIC_TREASURY", "NEXT_PUBLIC_TREASURY_BASE_ADDRESS");
    const USDC_BASE = envAny("USDC_BASE", "NEXT_PUBLIC_BASE_USDC", "NEXT_PUBLIC_USDC_BASE");

    if (!TREASURY) {
      return NextResponse.json(
        { ok: false, error: "Missing TREASURY_BASE_ADDRESS (or NEXT_PUBLIC_TREASURY)" },
        { status: 500 }
      );
    }

    // Minimal amounts (fallback ke NEXT_PUBLIC jika kamu belum punya server env khusus)
    const MIN_USDC_STR = envAny("PAYMENT_USDC", "MIN_PAY_USDC", "NEXT_PUBLIC_PAY_USDC", "NEXT_PUBLIC_PAYMENT_USDC") || "0.1";
    const MIN_ETH_STR  = envAny("MIN_PAY_ETH", "NEXT_PUBLIC_PAY_ETH") || "0"; // kalau kamu gak pakai ETH, biarin 0

    const treasury = toAddr(TREASURY);
    const usdc = USDC_BASE ? toAddr(USDC_BASE) : null;
    const user = userAddress ? toAddr(userAddress) : null;

    if (!treasury) {
      return NextResponse.json({ ok: false, error: "Invalid TREASURY address" }, { status: 500 });
    }

    const publicClient = createPublicClient({
      transport: http(BASE_RPC_URL),
    });

    const tx = await publicClient.getTransaction({ hash: txHash });
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

    // receipt.status: 'success'/'reverted' (viem)
    if (receipt.status !== "success") {
      return NextResponse.json({ ok: false, error: "Transaction reverted" }, { status: 400 });
    }

    // IMPORTANT: countdown 10 detik setelah tx confirmed (receipt sudah ok)
    const unlockAt = Date.now() + 10_000;

    // ====== METHOD 1: ETH payment (tx.to == treasury) ======
    const minEth = parseEther(String(MIN_ETH_STR));
    const txTo = tx.to ? toAddr(tx.to) : null;

    if (txTo && txTo === treasury && tx.value >= minEth && minEth > 0n) {
      // optional: tie to payer
      if (user && tx.from && toAddr(tx.from) !== user) {
        return NextResponse.json({ ok: false, error: "tx.from does not match userAddress" }, { status: 400 });
      }

      return NextResponse.json({
        ok: true,
        method: "ETH",
        unlockAt,
        txFrom: tx.from,
        txTo: tx.to,
        valueWei: tx.value.toString(),
      });
    }

    // ====== METHOD 2: USDC payment (ERC20 Transfer to treasury) ======
    // We only try if USDC is configured
    if (usdc) {
      const minUsdc = parseUnits(String(MIN_USDC_STR), 6);

      // USDC transfer: tx.to should be USDC contract, and logs contain Transfer(to=treasury)
      const txToIsUsdc = txTo && txTo === usdc;

      if (txToIsUsdc) {
        let paidAmount = 0n;
        let matched = false;

        for (const log of receipt.logs) {
          // only logs from USDC contract
          const logAddr = toAddr(log.address);
          if (!logAddr || logAddr !== usdc) continue;

          try {
            const decoded = decodeEventLog({
              abi: erc20Abi,
              data: log.data,
              topics: log.topics,
            });

            if (decoded.eventName !== "Transfer") continue;

            const from = toAddr(decoded.args.from);
            const to = toAddr(decoded.args.to);
            const value = decoded.args.value;

            if (!to || to !== treasury) continue;

            // kalau userAddress dikirim dari frontend, kita ikat “from” harus user
            if (user && from !== user) continue;

            paidAmount += value;
            matched = true;
          } catch {
            // ignore non-matching logs
          }
        }

        if (!matched) {
          return NextResponse.json(
            { ok: false, error: "No USDC Transfer to treasury found in receipt" },
            { status: 400 }
          );
        }

        if (paidAmount < minUsdc) {
          return NextResponse.json(
            { ok: false, error: `USDC paid too low (${paidAmount.toString()} < ${minUsdc.toString()})` },
            { status: 400 }
          );
        }

        return NextResponse.json({
          ok: true,
          method: "USDC",
          unlockAt,
          paidRaw: paidAmount.toString(),
          minRaw: minUsdc.toString(),
          txFrom: tx.from,
          txTo: tx.to,
        });
      }
    }

    // If reach here: tx tidak match ETH maupun USDC pattern
    return NextResponse.json(
      {
        ok: false,
        error: "Payment not detected. Send ETH to treasury OR send USDC transfer to treasury.",
        hint: {
          treasury,
          usdc: usdc || null,
        },
      },
      { status: 400 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.shortMessage || e?.message || "unknown" },
      { status: 500 }
    );
  }
}
