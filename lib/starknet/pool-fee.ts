import type { AppNetwork } from "@/lib/network";

import { starknetOf } from "./constants";
import { createProvider } from "./status";

/**
 * Shown until the pool answers. Sepolia charges this, mainnet charges more, so
 * the guess is the one that never overstates what a payment costs.
 */
export const FALLBACK_POOL_FEE = BigInt(2) * BigInt(10) ** BigInt(18);

const cache = new Map<AppNetwork, bigint>();

export function cachedPoolFee(network: AppNetwork): bigint | undefined {
  return cache.get(network);
}

/** The pool charges its fee in shielded STRK and publishes the amount. */
export async function readPoolFee(network: AppNetwork): Promise<bigint> {
  const cached = cache.get(network);
  if (cached !== undefined) return cached;

  const result = await createProvider(network).callContract({
    contractAddress: starknetOf(network).pool,
    entrypoint: "get_fee_amount",
    calldata: [],
  });
  const values = Array.isArray(result)
    ? result
    : ((result as { result?: string[] }).result ?? []);
  const [low, high] = values;
  if (!low) throw new Error("Pool returned no fee");

  const fee = BigInt(low) + (BigInt(high ?? "0x0") << BigInt(128));
  cache.set(network, fee);
  return fee;
}
