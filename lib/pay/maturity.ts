import type { AppNetwork } from "@/lib/network";

import { readActivity } from "./activity";

/**
 * STRK20 notes mature after ~10 blocks. Sepolia currently produces a block
 * roughly every 1.5-2s (checked against starknet_getBlockNumber /
 * starknet_getBlockWithTxHashes), so 10 blocks is closer to 15-20s, but
 * testnets slow down unpredictably - keep a generous multiple of that as a
 * safety margin rather than cutting it as close as the real chain allows.
 */
export const NOTE_MATURITY_MS = 45_000;

/**
 * Shield is not the only thing that leaves a fresh, unmatured USDC note: a
 * donation or unshield that does not spend the whole note creates a new
 * surplus note back to the sender, which needs the same ~10-block wait
 * before it can move again. Track whichever private-USDC-touching activity
 * this browser last recorded, not just shields - but only activity this app
 * submitted directly (source "morok"). reconcilePrivateBalance also writes
 * "receive"/"pay" rows with source "private" when it infers a balance change
 * it cannot attribute to a recent local action; those are timestamped at
 * whenever a refresh happened to notice the change, not at the real event,
 * so using them here would restart the countdown on every unrelated refresh
 * (e.g. clicking "Check pending donation").
 */
export function latestUsdcShieldAt(
  network: AppNetwork,
  address: string,
): number | null {
  const hit = readActivity(network, address).find(
    (item) =>
      (item.kind === "shield" || item.kind === "pay" || item.kind === "unshield") &&
      item.label !== "STRK" &&
      item.source !== "private",
  );
  return hit?.at ?? null;
}

export function usdcNoteReady(args: {
  privateUsdc: bigint;
  lastShieldAt: number | null;
  now: number;
}): { ready: boolean; remainingMs: number } {
  if (args.privateUsdc <= BigInt(0)) {
    return { ready: false, remainingMs: 0 };
  }
  if (args.lastShieldAt === null) {
    return { ready: true, remainingMs: 0 };
  }
  const elapsed = args.now - args.lastShieldAt;
  if (elapsed >= NOTE_MATURITY_MS) {
    return { ready: true, remainingMs: 0 };
  }
  return { ready: false, remainingMs: NOTE_MATURITY_MS - elapsed };
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
