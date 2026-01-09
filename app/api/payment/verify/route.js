import { NextResponse } from "next/server";
import { verifyBaseUsdcTransfer } from "@/lib/baseVerify.js";
import { set } from "@/lib/store.js";
import { getClientIp } from "@/lib/ip.js";
import { rateLimit } from "@/lib/rateLimit.js";

export const runtime = "nodejs";

export async function POST(req) {
  try {
    // Rate limit verify calls to reduce abuse
    const ip = getClientIp(req);
    const rl = await rateLimit({
      key: `verify:${ip}`,
      limit: Number(process.env.RL_VERIFY_LIMIT || "20"),
      windowSec: Number(process.env.RL_VERIFY_WINDOW_SEC || "600"),
    });
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, code: "RATE_LIMIT", error: `Too many requests. Try again in ${rl.retryAfter}s.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const { wallet, txHash } = await req.json();
    if (!wallet || !txHash) {
      return NextResponse.json({ ok: false, error: "wallet and txHash required" }, { status: 400 });
    }

    const treasury = process.env.TREASURY_BASE_ADDRESS;
    if (!treasury) return NextResponse.json({ ok: false, error: "Server missing TREASURY_BASE_ADDRESS" }, { status: 500 });

    const min = BigInt(Math.floor(Number(process.env.PAYMENT_USDC || "0.1") * 1e6));

    const res = await verifyBaseUsdcTransfer({
      txHash,
      from: wallet,
      to: treasury,
      minAmount6: min,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    }

    // store payment record
    await set(`payment:${txHash}`, { wallet, txHash, verified: true, ts: Date.now() }, { ex: 60 * 60 * 24 });
    await set(`wallet:${wallet.toLowerCase()}:paymentTx`, txHash, { ex: 60 * 60 * 24 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
