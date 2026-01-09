import { createPublicClient, http, parseAbiItem, decodeEventLog } from "viem";
import { base } from "viem/chains";

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export async function verifyBaseUsdcTransfer({ txHash, from, to, minAmount6 }) {
  const rpc = process.env.BASE_RPC_URL;
  if (!rpc) throw new Error("Missing BASE_RPC_URL in env.");

  const client = createPublicClient({ chain: base, transport: http(rpc) });
  const receipt = await client.getTransactionReceipt({ hash: txHash });

  if (receipt.status !== "success") return { ok: false, error: "tx_failed" };

  const usdc = (process.env.USDC_BASE || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase();
  const fromLc = from.toLowerCase();
  const toLc = to.toLowerCase();

  for (const log of receipt.logs) {
    if ((log.address || "").toLowerCase() !== usdc) continue;
    if (!log.topics?.length) continue;
    if (log.topics[0] !== TRANSFER_EVENT.topic) continue;

    const decoded = decodeEventLog({
      abi: [TRANSFER_EVENT],
      data: log.data,
      topics: log.topics,
    });

    const lf = decoded.args.from.toLowerCase();
    const lt = decoded.args.to.toLowerCase();
    const value = decoded.args.value;

    if (lf === fromLc && lt === toLc && value >= minAmount6) {
      return { ok: true };
    }
  }

  return { ok: false, error: "no_matching_transfer" };
}
