import { NextResponse } from "next/server";
import { getArcTreasuryAccount, getArcUsdcBalance6 } from "@/lib/arcSend.js";

export const runtime = "nodejs";

function to6(amountStr) {
  // USDC 6 decimals
  const n = Number(amountStr);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.round(n * 1e6));
}

export async function GET() {
  try {
    const reward = process.env.REWARD_USDC || "10";
    const buffer = process.env.ARC_GAS_BUFFER_USDC || "0.1";
    const reward6 = to6(reward);
    const buffer6 = to6(buffer);

    const treasury = getArcTreasuryAccount();
    const bal6 = await getArcUsdcBalance6(treasury.address);

    const needed6 = reward6 + buffer6;
    const state = bal6 >= needed6 ? "ok" : (bal6 >= reward6 ? "low" : "empty");

    return NextResponse.json({
      ok: true,
      state,
      balance6: bal6.toString(),
      rewardUsdc: reward,
      bufferUsdc: buffer,
      adminContact: process.env.NEXT_PUBLIC_ADMIN_CONTACT || null,
      adminContactUrl: process.env.NEXT_PUBLIC_ADMIN_CONTACT_URL || null,
    });
  } catch (e) {
    // If ARC private key missing, treat as not configured
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
