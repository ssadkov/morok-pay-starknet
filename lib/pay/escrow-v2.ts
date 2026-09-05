import { hash, num, shortString } from "starknet";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { parseAppNetwork, type AppNetwork } from "@/lib/network";

/** Domain tag, mirrors `ESCROW_V2_TAG` in contracts/src/escrow_v2.cairo. */
export const ESCROW_V2_TAG = "MOROK_ESCROW:V2";

const SEED_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * A V2 link carries a seed, and the seed is an EVM private key.
 *
 * That is the whole trick behind "to an address" and "to a link" being one
 * contract rule. The entry's owner is always an EVM-derived Starknet account;
 * for an invoice it is the recipient's own, and for a link it is one nobody
 * has ever used, whose key travels in the URL. Holding the link *is* holding
 * the account, so the claim is authorised the same way in both cases and the
 * contract never learns which product it is serving.
 *
 * It also fixes what V1 could not. There the link held a secret the claim
 * revealed in calldata, while the destination was chosen by whoever submitted
 * the transaction - so relaying a claim meant trusting the relayer not to
 * redirect it. Here the destination is inside a signature only the link's
 * holder can produce.
 */
export function randomSeed(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function isSeed(value: string | undefined): value is Hex {
  return typeof value === "string" && SEED_RE.test(value) && BigInt(value) !== BigInt(0);
}

/** The EVM address a link's seed controls. */
export function seedEvmAddress(seed: Hex): string {
  return privateKeyToAccount(seed).address;
}

/**
 * The salt, and through it the commitment, are derived from the seed rather
 * than carried separately - one value in the URL, and no way to hold a link
 * that cannot compute its own entry.
 *
 * The commitment is only a storage key: V2 authorises by owner, never by
 * preimage, so publishing it on chain gives away nothing but the fact that
 * some entry exists.
 */
export function commitmentFromSeed(seed: Hex): string {
  const salt = hash.computePoseidonHashOnElements([
    shortString.encodeShortString(ESCROW_V2_TAG),
    num.toHex(BigInt(seed)),
  ]);
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString(ESCROW_V2_TAG),
    salt,
  ]);
}

/**
 * An entry the recipient finds by address instead of by link. There is no seed
 * to derive from, so the salt has to be random and kept by whoever can tell
 * the recipient where to look - which for an indexed entry is the contract.
 */
export function commitmentFromSalt(salt: string): string {
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString(ESCROW_V2_TAG),
    salt,
  ]);
}

export type ClaimV2Request = {
  network: AppNetwork;
  seed: Hex;
  amount?: string;
};

export function claimV2Path(request: ClaimV2Request): string {
  const params = new URLSearchParams();
  params.set("n", request.network);
  params.set("k", request.seed);
  if (request.amount) params.set("amount", request.amount);
  return `/claim?${params.toString()}`;
}

export function claimV2Url(origin: string, request: ClaimV2Request): string {
  return `${origin.replace(/\/$/, "")}${claimV2Path(request)}`;
}

/**
 * `k` rather than V1's `s`, so an old link and a new one can never be mistaken
 * for each other: they authorise differently and are held by different
 * contracts, and a V1 secret read as a V2 seed would silently compute an entry
 * that does not exist.
 */
export function parseClaimV2Request(
  params: URLSearchParams,
  fallbackNetwork: AppNetwork,
): ClaimV2Request | null {
  const seed = params.get("k")?.trim() ?? "";
  if (!isSeed(seed)) return null;
  const amount = params.get("amount")?.trim() ?? "";
  return {
    network: parseAppNetwork(params.get("n"), fallbackNetwork),
    seed,
    amount: /^\d+(\.\d+)?$/.test(amount) ? amount : undefined,
  };
}
