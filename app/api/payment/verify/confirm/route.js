export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { ethers } from "ethers";

// IMPORTANT: correct relative path from:
// app/api/payment/verify/confirm/route.js  ->  app/api/_utils/...
import { getSession, saveSession } from "../../../_utils/session";

const USDC_TRANSFER_IFACE = new ethers.Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

const FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
];

function isAddr(x) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(x || ""));
}
function isTx(x) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(x || ""));
}

export async function POST(req) {
  try {
    const body = await req.json();

    const wallet = String(body.wallet || "");
    const method = String(body.method || "").toUpperCase(); // "USDC" | "ETH"
    const txHash = String(body.txHash || "");

    if (!isAddr(wallet)) return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 });
    if (!isTx(txHash)) return NextResponse.json({ ok: false, error: "Invalid txHash" }, { status: 400 });
    if (method !== "USDC" && method !== "ETH") {
      return NextResponse.json({ ok: false, error: "Invalid method" }, { status: 400 });
    }

    const TREASURY = process.env.TREASURY_BASE_ADDRESS;
    const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";

    if (!TREASURY || !isAddr(TREASURY)) {
      return NextResponse.json({ ok: false, error: "TREASURY_BASE_ADDRESS missing/invalid" }, { status: 500 });
    }

    const provider = new ethers.JsonRpcProvider(BASE_RPC);

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return NextResponse.json({ ok: false, error: "Tx not found" }, { status: 400 });
    if (receipt.status !== 1) return NextResponse.json({ ok: false, error: "Tx failed" }, { status: 400 });

    const tx = await provider.getTransaction(txHash);
    if (!tx) return NextResponse.json({ ok: false, error: "Tx not found" }, { status: 400 });

    if (!tx.from || tx.from.toLowerCase() !== wallet.toLowerCase()) {
      return NextResponse.json({ ok: false, error: "Tx sender mismatch" }, { status: 400 });
    }

    // ===== Verify payment =====
    if (method === "USDC") {
      const USDC = process.env.USDC_BASE || DEFAULT_USDC_BASE();
      const PAYMENT_USDC = process.env.PAYMENT_USDC || "0.1";

      const minAmount = ethers.parseUnits(String(PAYMENT_USDC), 6);

      let ok = false;

      for (const log of receipt.logs || []) {
        if (!log?.address) continue;
        if (log.address.toLowerCase() !== USDC.toLowerCase()) continue;

        try {
          const parsed = USDC_TRANSFER_IFACE.parseLog(log);
          const from = String(parsed.args.from || "").toLowerCase();
          const to = String(parsed.args.to || "").toLowerCase();
          const value = BigInt(parsed.args.value || 0);

          if (from === wallet.toLowerCase() && to === TREASURY.toLowerCase() && value >= minAmount) {
            ok = true;
            break;
          }
        } catch {
          // ignore parse errors
        }
      }

      if (!ok) {
        return NextResponse.json({ ok: false, error: "USDC payment not detected" }, { status: 400 });
      }
    } else {
      // ETH payment
      if (!tx.to || tx.to.toLowerCase() !== TREASURY.toLowerCase()) {
        return NextResponse.json({ ok: false, error: "ETH recipient mismatch" }, { status: 400 });
      }

      const PAYMENT_USD = process.env.PAYMENT_USD || "0.1";
      const FEED = process.env.CHAINLINK_ETH_USD_FEED || DEFAULT_ETH_FEED_BASE();
      const BPS = Number(process.env.ETH_PAY_SLIPPAGE_BPS || "200");

      if (!isAddr(FEED)) return NextResponse.json({ ok: false, error: "CHAINLINK_ETH_USD_FEED invalid" }, { status: 500 });

      const feed = new ethers.Contract(FEED, FEED_ABI, provider);

      let d = 8;
      try {
        d = await feed.decimals();
      } catch {
        // keep default
      }

      const rd = await feed.latestRoundData();
      const price = rd?.answer;

      if (price == null || BigInt(price) <= 0n) {
        return NextResponse.json({ ok: false, error: "Price feed error" }, { status: 500 });
      }

      const usd18 = ethers.parseUnits(String(PAYMENT_USD), 18);
      let required = (usd18 * (10n ** BigInt(d))) / BigInt(price);

      const bps = BigInt(Math.max(0, BPS));
      required = (required * (10000n + bps)) / 10000n;

      if (BigInt(tx.value || 0) < required) {
        return NextResponse.json({ ok: false, error: "ETH value below required" }, { status: 400 });
      }
    }

    // ===== Save confirmed payment in session =====
    const { sid, data } = await getSession();

    data.payment = {
      confirmed: true,
      method,
      wallet,
      txHash,
      at: Date.now(),
    };

    await saveSession(sid, data);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

function DEFAULT_USDC_BASE() {
  return "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
}
function DEFAULT_ETH_FEED_BASE() {
  return "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
}
