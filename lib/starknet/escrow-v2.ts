import { num, validateAndParseAddress } from "starknet";

import type { AppNetwork } from "@/lib/network";

import { starknetOf } from "./constants";
import { createProvider } from "./status";

export type EscrowV2Entry = {
  token: string;
  amount: bigint;
  owner: string;
  refundOwner: string;
  /** Unix seconds. Zero means it never expires and can never be refunded. */
  expiresAt: bigint;
  claimed: boolean;
};

function values(result: unknown): string[] {
  return Array.isArray(result)
    ? (result as string[])
    : (((result as { result?: string[] }).result ?? []) as string[]);
}

/**
 * What is parked behind a commitment, if anything.
 *
 * An empty token means the entry does not exist - the contract returns a zero
 * struct for an unknown key rather than reverting, so this is the one field
 * worth testing before trusting the rest.
 */
export async function readEscrowV2Entry(args: {
  network: AppNetwork;
  commitment: string;
}): Promise<EscrowV2Entry | null> {
  const address = starknetOf(args.network).escrowV2;
  if (!address) return null;

  const result = await createProvider(args.network).callContract({
    contractAddress: address,
    entrypoint: "get_entry",
    calldata: [args.commitment],
  });
  const [token, amount, owner, refundOwner, expiresAt, claimed] = values(result);
  if (!token || BigInt(token) === BigInt(0)) return null;
  return {
    token,
    amount: BigInt(amount ?? "0x0"),
    owner: num.toHex(BigInt(owner ?? "0x0")),
    refundOwner: num.toHex(BigInt(refundOwner ?? "0x0")),
    expiresAt: BigInt(expiresAt ?? "0x0"),
    claimed: BigInt(claimed ?? "0x0") !== BigInt(0),
  };
}

/**
 * Everything waiting for an address, for entries whose sender opted into the
 * index. Unindexed entries are invisible here by design: they are found
 * through the link that carries their seed, and nothing else can find them -
 * which is the point.
 */
export async function readEscrowV2Entries(args: {
  network: AppNetwork;
  owner: string;
}): Promise<string[]> {
  const address = starknetOf(args.network).escrowV2;
  if (!address) return [];
  const provider = createProvider(args.network);
  const owner = validateAndParseAddress(args.owner);

  const count = Number(
    BigInt(
      values(
        await provider.callContract({
          contractAddress: address,
          entrypoint: "entry_count",
          calldata: [owner],
        }),
      )[0] ?? "0x0",
    ),
  );
  const commitments: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const [commitment] = values(
      await provider.callContract({
        contractAddress: address,
        entrypoint: "entry_at",
        calldata: [owner, num.toHex(index)],
      }),
    );
    if (commitment) commitments.push(commitment);
  }
  return commitments;
}

/** The floor a deposit of this token has to clear. */
export async function readEscrowV2Minimum(args: {
  network: AppNetwork;
  token: string;
}): Promise<bigint> {
  const address = starknetOf(args.network).escrowV2;
  if (!address) return BigInt(0);
  const [minimum] = values(
    await createProvider(args.network).callContract({
      contractAddress: address,
      entrypoint: "minimum_amount",
      calldata: [validateAndParseAddress(args.token)],
    }),
  );
  return BigInt(minimum ?? "0x0");
}

export type EscrowV2Status =
  | { state: "missing" }
  | { state: "claimed" }
  | { state: "expired"; entry: EscrowV2Entry }
  | { state: "claimable"; entry: EscrowV2Entry };

/**
 * The four states a claimer can be in, decided in one place so the UI does not
 * re-derive them and get the expiry boundary subtly wrong.
 *
 * `nowSeconds` is passed in rather than read from the clock here: the contract
 * compares against the block timestamp, and a browser's clock can be minutes
 * off in either direction.
 */
export function escrowV2Status(
  entry: EscrowV2Entry | null,
  nowSeconds: bigint,
): EscrowV2Status {
  if (!entry) return { state: "missing" };
  if (entry.claimed) return { state: "claimed" };
  if (entry.expiresAt !== BigInt(0) && nowSeconds >= entry.expiresAt) {
    return { state: "expired", entry };
  }
  return { state: "claimable", entry };
}
