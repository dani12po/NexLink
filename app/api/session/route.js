import { NextResponse } from "next/server";
import { getSession } from "@/lib/session.js";
import { get } from "@/lib/store.js";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sess = await getSession();
    if (!sess) return NextResponse.json({ wallet: null, x: { connected: false, followed: false } });

    const wallet = sess.wallet || null;
    const x = sess.x || { connected: false, followed: false };

    const paymentTx = wallet ? await get(`wallet:${wallet.toLowerCase()}:paymentTx`) : null;
    const payment = paymentTx ? await get(`payment:${paymentTx}`) : null;

    const claim = wallet ? await get(`claim:${wallet.toLowerCase()}`) : null;
    const claimX = x?.userId ? await get(`claimx:${x.userId}`) : null;

    return NextResponse.json({
      wallet,
      x: {
        connected: !!x.connected,
        followed: !!x.followed,
        username: x.username || null,
        userId: x.userId || null,
      },
      payment: payment ? { txHash: payment.txHash, verified: !!payment.verified } : { txHash: paymentTx || null, verified: false },
      claim: claim ? { claimed: true, arcTxHash: claim.arcTxHash, ts: claim.ts } : { claimed: false },
      claimX: claimX ? { claimed: true, wallet: claimX.wallet || null, arcTxHash: claimX.arcTxHash, ts: claimX.ts } : { claimed: false },
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
