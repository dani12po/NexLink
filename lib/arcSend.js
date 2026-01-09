import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "./chains";

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
