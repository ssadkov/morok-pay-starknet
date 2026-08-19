import type { AppNetwork } from "@/lib/network";

import { starknetOf } from "./constants";
import { createProvider } from "./status";

export type EscrowEntry = {
  token: string;
  amount: bigint;
  claimed: boolean;
};

/**
 * Read what is parked behind a claim commitment. Empty token means nothing
 * was deposited under this hash.
 */
export async function readEscrowEntry(args: {
  network: AppNetwork;
  commitment: string;
}): Promise<EscrowEntry | null> {
  const address = starknetOf(args.network).escrow;
  if (!address) return null;

  const result = await createProvider(args.network).callContract({
    contractAddress: address,
    entrypoint: "get_entry",
    calldata: [args.commitment],
  });
  const values = Array.isArray(result)
    ? result
    : ((result as { result?: string[] }).result ?? []);
  const [token, amount, claimed] = values;
  if (!token || BigInt(token) === BigInt(0)) return null;
  return {
    token,
    amount: BigInt(amount ?? "0x0"),
    claimed: BigInt(claimed ?? "0x0") !== BigInt(0),
  };
}
