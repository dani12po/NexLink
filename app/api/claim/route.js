export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSession, saveSession } from "../_utils/session";
import { storeGet, storeSet } from "../_utils/store";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export async function POST(req) {
  try {
    const body = await req.json();
    const wallet = String(body.wallet || "");
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 });
    }

    const { sid, data } = await getSession();

    // checks: paid + x login + followed
    if (!data?.payment?.confirmed) return NextResponse.json({ ok: false, error: "Payment required" }, { status: 401 });
    if (data.payment.wallet?.toLowerCase() !== wallet.toLowerCase()) {
      return NextResponse.json({ ok: false, error: "Wallet mismatch" }, { status: 401 });
    }

    const xUserId = data?.x?.user?.id;
    if (!data?.x?.access_token || !xUserId) return NextResponse.json({ ok: false, error: "Login X required" }, { status: 401 });
    if (!data?.followed) return NextResponse.json({ ok: false, error: "Follow required" }, { status: 401 });

    // one-claim-per-wallet + one-claim-per-x
    const claimedWalletKey = `claimed_wallet:${wallet.toLowerCase()}`;
    const claimedXKey = `claimed_x:${String(xUserId)}`;

    if (await storeGet(claimedWalletKey)) return NextResponse.json({ ok: false, error: "This wallet already claimed" }, { status: 409 });
    if (await storeGet(claimedXKey)) return NextResponse.json({ ok: false, error: "This X account already claimed" }, { status: 409 });

    // faucet config
    const ARC_RPC_URL = process.env.ARC_RPC_URL;
    const ARC_USDC = process.env.ARC_USDC_ERC20;
    const TREASURY_PK = process.env.ARC_TREASURY_PRIVATE_KEY;

    const REWARD_USDC = process.env.REWARD_USDC || "10";
    const ARC_GAS_BUFFER_USDC = process.env.ARC_GAS_BUFFER_USDC || "0.1";

    if (!ARC_RPC_URL || !ARC_USDC || !TREASURY_PK) {
      return NextResponse.json({ ok: false, error: "Arc env missing (ARC_RPC_URL / ARC_USDC_ERC20 / ARC_TREASURY_PRIVATE_KEY)" }, { status: 500 });
    }

    const provider = new ethers.JsonRpcProvider(ARC_RPC_URL);
    const signer = new ethers.Wallet(TREASURY_PK, provider);
    const token = new ethers.Contract(ARC_USDC, ERC20_ABI, signer);

    let dec = 6;
    try { dec = await token.decimals(); } catch {}

    const reward = ethers.parseUnits(String(REWARD_USDC), dec);
    const buffer = ethers.parseUnits(String(ARC_GAS_BUFFER_USDC), dec);

    // faucet empty friendly
    const bal = await token.balanceOf(await signer.getAddress());
    if (bal < reward + buffer) {
      return NextResponse.json({
        ok: false,
        error: "Faucet empty. Please wait for refill or contact admin.",
        code: "FAUCET_EMPTY",
      }, { status: 409 });
    }

    // send reward
    const tx = await token.transfer(wallet, reward);
    const receipt = await tx.wait(1);

    // mark claimed
    await storeSet(claimedWalletKey, { at: Date.now(), txHash: tx.hash }, 60 * 60 * 24 * 365);
    await storeSet(claimedXKey, { at: Date.now(), txHash: tx.hash }, 60 * 60 * 24 * 365);

    data.claimed = true;
    data.claimTx = { hash: tx.hash, at: Date.now() };
    await saveSession(sid, data);

    return NextResponse.json({ ok: true, txHash: tx.hash, arcReceipt: receipt?.hash || tx.hash });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
