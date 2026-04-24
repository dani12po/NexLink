import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) return null;
  return v;
}

function normalizePk(pk) {
  if (!pk) return null;
  // allow with/without 0x
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

export async function POST(req) {
  try {
    const ARC_RPC_URL = mustEnv("ARC_RPC_URL");
    const ARC_USDC = mustEnv("ARC_USDC") || mustEnv("ARC_USDC_ERC20");
    const PK_RAW = mustEnv("ARC_TREASURY_PRIVATE_KEY");

    if (!ARC_RPC_URL || !ARC_USDC || !PK_RAW) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing env. Required: ARC_RPC_URL, ARC_USDC (or ARC_USDC_ERC20), ARC_TREASURY_PRIVATE_KEY",
        },
        { status: 500 }
      );
    }

    const pk = normalizePk(PK_RAW);
    if (!pk) {
      return NextResponse.json({ ok: false, error: "Invalid private key" }, { status: 500 });
    }

    const { to, amount } = await req.json(); // amount string: "10"
    if (!to || !amount) {
      return NextResponse.json({ ok: false, error: "missing to/amount" }, { status: 400 });
    }

    // Arc USDC assumed 6 decimals
    const value = parseUnits(String(amount), 6);

    const account = privateKeyToAccount(pk);

    // NOTE: chain object optional; keeping minimal to avoid build-time issues
    const publicClient = createPublicClient({
      transport: http(ARC_RPC_URL),
    });

    const walletClient = createWalletClient({
      account,
      transport: http(ARC_RPC_URL),
    });

    // simulate first (helps avoid silent revert)
    const { request } = await publicClient.simulateContract({
      account,
      address: ARC_USDC,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, value],
    });

    const hash = await walletClient.writeContract(request);

    return NextResponse.json({ ok: true, hash });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.shortMessage || e?.message || "unknown" },
      { status: 500 }
    );
  }
}
