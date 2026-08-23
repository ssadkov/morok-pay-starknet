import type { AppNetwork } from "@/lib/network";

import { readActivity } from "./activity";

/** STRK20 notes mature after ~10 blocks. Use 12s/block so the wait is not short. */
export const NOTE_MATURITY_MS = 10 * 12_000;

export function latestUsdcShieldAt(
  network: AppNetwork,
  address: string,
): number | null {
  const hit = readActivity(network, address).find(
    (item) => item.kind === "shield" && item.label !== "STRK",
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
