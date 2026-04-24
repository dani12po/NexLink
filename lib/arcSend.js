import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "./arcChain";

// Sanity check — pastikan chain config benar (decimals USDC = 6)
if (arcTestnet?.nativeCurrency?.decimals !== 6) {
  console.error('[arcSend] FATAL: arcTestnet.decimals is not 6! Check lib/arcChain.ts')
}

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export function getArcTreasuryAccount() {
  const pk = process.env.ARC_TREASURY_PRIVATE_KEY;
  if (!pk) throw new Error("Missing ARC_TREASURY_PRIVATE_KEY in env.");
  return privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
}

export function getArcUsdcAddress() {
  return process.env.ARC_USDC_ERC20 || "0x3600000000000000000000000000000000000000";
}

export async function getArcUsdcBalance6(address) {
  const rpc = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(rpc),
  });
  const usdcArc = getArcUsdcAddress();
  const bal = await client.readContract({
    address: usdcArc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  });
  return BigInt(bal);
}

export async function sendArcUsdc({ to, amount6 }) {
  const rpc = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";

  const account = getArcTreasuryAccount();

  // ── Balance check sebelum transfer ──────────────────────────────────────
  const treasuryAddr = account.address;
  const balance = await getArcUsdcBalance6(treasuryAddr);
  if (balance < amount6) {
    const balStr = (Number(balance) / 1_000_000).toFixed(6);
    const amtStr = (Number(amount6) / 1_000_000).toFixed(6);
    throw new Error(`Treasury insufficient balance: ${balStr} USDC < ${amtStr} USDC required`);
  }
  // Log warning jika saldo di bawah 100 USDC
  if (balance < 100_000_000n) {
    console.warn(`[arcSend] Treasury balance low: ${(Number(balance) / 1_000_000).toFixed(2)} USDC`);
  }

  const client = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(rpc),
  });

  const usdcArc = getArcUsdcAddress();

  const hash = await client.writeContract({
    address: usdcArc,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [to, amount6],
  });

  return hash;
}
