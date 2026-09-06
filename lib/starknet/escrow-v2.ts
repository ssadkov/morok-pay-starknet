import { num, validateAndParseAddress } from "starknet";

import type { AppNetwork } from "@/lib/network";

import { starknetOf } from "./constants";
import { createProvider } from "./status";
import {
  pollTransactionReceipt,
  type ReceiptState,
} from "./transaction-confirmation";

export type EscrowV2Entry = {
  token: string;
  amount: bigint;
  owner: string;
  refundOwner: string;
  /** Unix seconds after which refund becomes available. Claim stays allowed. Zero = never refundable. */
  expiresAt: bigint;
  resolution: "open" | "claimed" | "refunded";
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
  escrow?: string;
}): Promise<EscrowV2Entry | null> {
  const address = args.escrow ?? starknetOf(args.network).escrowV2;
  if (!address) return null;

  const result = await createProvider(args.network).callContract({
    contractAddress: address,
    entrypoint: "get_entry",
    calldata: [args.commitment],
  });
  const [token, amount, owner, refundOwner, expiresAt, rawState] = values(result);
  if (!token || BigInt(token) === BigInt(0)) return null;
  return {
    token,
    amount: BigInt(amount ?? "0x0"),
    owner: num.toHex(BigInt(owner ?? "0x0")),
    refundOwner: num.toHex(BigInt(refundOwner ?? "0x0")),
    expiresAt: BigInt(expiresAt ?? "0x0"),
    resolution:
      BigInt(rawState ?? "0x0") === 2n
        ? "refunded"
        : BigInt(rawState ?? "0x0") === 1n
          ? "claimed"
          : "open",
  };
}

/**
 * Convenience index for opted-in entries. Unindexed entries are still public:
 * anyone can enumerate Escrowed events and call get_entry on each commitment.
 * Never treat omission from this index as a sender privacy guarantee.
 */
export async function readEscrowV2Entries(args: {
  network: AppNetwork;
  owner: string;
  limit?: number;
  offset?: number;
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
  const offset = Math.max(0, Math.floor(args.offset ?? 0));
  const limit = Math.min(50, Math.max(1, Math.floor(args.limit ?? 20)));
  const newestExclusive = Math.max(0, count - offset);
  const oldest = Math.max(0, newestExclusive - limit);
  const indices = Array.from(
    { length: newestExclusive - oldest },
    (_, position) => newestExclusive - position - 1,
  );
  const commitments = await Promise.all(
    indices.map(async (index) => {
      const [commitment] = values(await provider.callContract({
        contractAddress: address,
        entrypoint: "entry_at",
        calldata: [owner, num.toHex(index)],
      }));
      return commitment;
    }),
  );
  return commitments.filter((commitment): commitment is string => Boolean(commitment));
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
  | { state: "refunded" }
  | {
      state: "claimable";
      entry: EscrowV2Entry;
      /** Sender may also reclaim; claim still works until one exit wins. */
      refundable: boolean;
    };

/**
 * Claim is never killed by expiry — only by a successful claim or refund.
 * `refundable` means the recovery key may race the claimer after expires_at.
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
  if (entry.resolution === "claimed") return { state: "claimed" };
  if (entry.resolution === "refunded") return { state: "refunded" };
  return {
    state: "claimable",
    entry,
    refundable:
      entry.expiresAt !== BigInt(0) && nowSeconds >= entry.expiresAt,
  };
}

/** Wait for Starknet finality, then verify the escrow state itself. */
export async function confirmEscrowV2Transaction(args: {
  network: AppNetwork;
  transactionHash: string;
  commitment: string;
  escrow?: string;
  expected: "open" | "claimed" | "refunded" | "closed";
  timeoutMs?: number;
}): Promise<ReceiptState | "mismatch"> {
  const provider = createProvider(args.network);
  const receipt = await pollTransactionReceipt({
    read: () => provider.getTransactionReceipt(args.transactionHash),
    timeoutMs: args.timeoutMs,
  });
  if (receipt !== "confirmed") return receipt;
  const entry = await readEscrowV2Entry(args);
  if (!entry) return "mismatch";
  const matches =
    args.expected === "closed"
      ? entry.resolution !== "open"
      : entry.resolution === args.expected;
  return matches ? "confirmed" : "mismatch";
}
