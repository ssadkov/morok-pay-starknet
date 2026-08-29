import type { AppNetwork } from "@/lib/network";

import { starknetOf } from "./constants";
import { createProvider } from "./status";

export type AccountPresence = "deployed" | "undeployed" | "unknown";
export type PoolRegistration = "registered" | "unregistered" | "unknown";

/**
 * A Ready X address is the same on every network but deployed on each one
 * separately. The pool cannot credit a note to an account that does not exist,
 * so a payment to an address that never touched this network just fails.
 */
export async function accountPresence(
  network: AppNetwork,
  address: string,
): Promise<AccountPresence> {
  try {
    await createProvider(network).getClassHashAt(address);
    return "deployed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Contract not found") ||
      message.includes("CONTRACT_NOT_FOUND")
      ? "undeployed"
      : "unknown";
  }
}

/**
 * STRK20 recipients need an immutable viewing key registered in the pool.
 * This view is public and reveals only whether registration happened, never
 * the private viewing key or the user's notes.
 */
export async function poolRegistration(
  network: AppNetwork,
  address: string,
): Promise<PoolRegistration> {
  try {
    const result = await createProvider(network).callContract({
      contractAddress: starknetOf(network).pool,
      entrypoint: "get_public_key",
      calldata: [address],
    });
    const values = Array.isArray(result)
      ? result
      : ((result as { result?: string[] }).result ?? []);
    const publicKey = values[0];
    if (!publicKey) return "unknown";
    return BigInt(publicKey) === BigInt(0) ? "unregistered" : "registered";
  } catch {
    return "unknown";
  }
}
