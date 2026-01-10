import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  decodeEventLog,
  erc20Abi,
  parseEther,
  parseUnits,
} from "viem";
import { base } from "viem/chains";

// ===== CONFIG =====
const BASE_RPC_URL = process.env.BASE_RPC_URL;
const RECEIVER = (process.env.PAYMENT_RECEIVER || "").toLowerCase();

// Base mainnet native USDC (Circle)
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;

const MIN_PAY_USDC = process.env.MIN_PAY_USDC ?? "0.10";   // $0.10
const MIN_PAY_ETH  = process.env.MIN_PAY_ETH  ?? "0.00005"; // fixed eth (opsional)

// TODO: ganti ini ke KV/DB kalau sudah siap
const memoryStore = globalThis.__arc_pay_store || (globalThis.__arc_pay_store = new Map());
function saveState(addressLower, data) {
  memoryStore.set(addressLower, { ...(memoryStore.get(addressLower) || {}), ...data });
}
function getState(addressLower) {
  return memoryStore.get(addressLower) || null;
}

const client = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

export async function POST(req) {
  try {
    const { txHash, userAddress } = await req.json();

    if (!BASE_RPC_URL) {
      return NextResponse.json({ ok: false, error: "Missing BASE_RPC_URL" }, { status: 500 });
    }
    if (!RECEIVER) {
      return NextResponse.json({ ok: false, error: "Missing PAYMENT_RECEIVER" }, { status: 500 });
    }
    if (!txHash || !userAddress) {
      return NextResponse.json({ ok: false, error: "missing txHash/userAddress" }, { status: 400 });
    }

    const addr = userAddress.toLowerCase();

    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash }),
      client.getTransactionReceipt({ hash: txHash }),
    ]);

    if (receipt.status !== "success") {
      return NextResponse.json({ ok: false, error: "tx reverted" }, { status: 400 });
    }
    if ((tx.from || "").toLowerCase() !== addr) {
      return NextResponse.json({ ok: false, error: "tx.from != userAddress" }, { status: 400 });
    }

    // ---- ETH payment check ----
    const minEth = parseEther(MIN_PAY_ETH);
    const isEthPay =
      tx.to?.toLowerCase?.() === RECEIVER &&
      tx.value >= minEth;

    // ---- USDC payment check (Transfer event) ----
    const minUsdc = parseUnits(MIN_PAY_USDC, USDC_DECIMALS);
    let isUsdcPay = false;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC_BASE.toLowerCase()) continue;

      try {
        const decoded = decodeEventLog({
          abi: erc20Abi,
          data: log.data,
          topics: log.topics,
        });

        if (decoded.eventName !== "Transfer") continue;

        const { from, to, value } = decoded.args;

        if (
          from?.toLowerCase?.() === addr &&
          to?.toLowerCase?.() === RECEIVER &&
          value >= minUsdc
        ) {
          isUsdcPay = true;
          break;
        }
      } catch {
        // ignore
      }
    }

    if (!isEthPay && !isUsdcPay) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "payment not matched. (wrong receiver/amount/token or not Base mainnet)",
        },
        { status: 400 }
      );
    }

    const now = Date.now();
    const unlockAt = now + 10_000;

    saveState(addr, {
      payTxHash: txHash,
      payMethod: isUsdcPay ? "USDC" : "ETH",
      paidAt: now,
      unlockAt,
    });

    return NextResponse.json({
      ok: true,
      payMethod: isUsdcPay ? "USDC" : "ETH",
      paidAt: now,
      unlockAt,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "unknown error" },
      { status: 500 }
    );
  }
}

// (opsional) buat UI polling status tanpa re-verify tx
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const userAddress = searchParams.get("address");
  if (!userAddress) return NextResponse.json({ ok: false, error: "missing address" }, { status: 400 });

  const state = getState(userAddress.toLowerCase());
  return NextResponse.json({ ok: true, state });
}
