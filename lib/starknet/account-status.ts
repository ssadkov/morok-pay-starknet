import type { AppNetwork } from "@/lib/network";

import { createProvider } from "./status";

export type AccountPresence = "deployed" | "undeployed" | "unknown";

/**
 * A Ready address is the same on every network but deployed on each one
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
