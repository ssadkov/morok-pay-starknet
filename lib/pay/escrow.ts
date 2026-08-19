import { hash, shortString } from "starknet";

import { parseAppNetwork, type AppNetwork } from "@/lib/network";

/** Domain tag, mirrors `ESCROW_TAG` in contracts/src/escrow.cairo. */
export const ESCROW_TAG = "MOROK_ESCROW:V1";

const FELT_RE = /^0x[0-9a-fA-F]{1,64}$/;

export function randomSecret(): string {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function computeEscrowCommitment(secret: string): string {
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString(ESCROW_TAG),
    secret,
  ]);
}

export function isSecret(value: string | undefined): value is string {
  return typeof value === "string" && FELT_RE.test(value) && BigInt(value) !== BigInt(0);
}

export type ClaimRequest = {
  network: AppNetwork;
  secret: string;
  amount?: string;
};

export function serializeClaimRequest(request: ClaimRequest): URLSearchParams {
  const params = new URLSearchParams();
  params.set("n", request.network);
  params.set("s", request.secret);
  if (request.amount) params.set("amount", request.amount);
  return params;
}

export function claimPath(request: ClaimRequest): string {
  return `/claim?${serializeClaimRequest(request).toString()}`;
}

export function claimUrl(origin: string, request: ClaimRequest): string {
  return `${origin.replace(/\/$/, "")}${claimPath(request)}`;
}

export function parseClaimRequest(
  params: URLSearchParams,
  fallbackNetwork: AppNetwork,
): ClaimRequest | null {
  const secret = params.get("s")?.trim() ?? "";
  if (!isSecret(secret)) return null;
  const amount = params.get("amount")?.trim() ?? "";
  return {
    network: parseAppNetwork(params.get("n"), fallbackNetwork),
    secret,
    amount: /^\d+(\.\d+)?$/.test(amount) ? amount : undefined,
  };
}
