import { hash, num, validateAndParseAddress } from "starknet";
import { recoverTypedDataAddress, serializeSignature, toHex } from "viem";

import type { AppNetwork } from "@/lib/network";
import { eth712OutsideExecutionTypedData } from "./eth712-outside-execution";
import { privacySdkOf } from "./network";

const FELT_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const UINT128_LIMIT = 1n << 128n;
const UINT64_LIMIT = 1n << 64n;
const MAX_INTENT_LIFETIME = 900n;

export function escrowClaimFelt(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error("Invalid claim felt");
  }
  if (BigInt(value) >= FELT_PRIME) throw new Error("Claim felt is out of range");
  return num.toHex(BigInt(value));
}

/** Exact SRC9 wire format: one claim, two arguments, one Eth712 signature.
 * Validate the signed intent, not merely the separate factory ownership proof.
 * No extra calls, trailing data, or alternative selectors are sponsorable.
 */
export async function verifyEscrowClaimIntent(args: {
  calldata: unknown;
  network: AppNetwork;
  escrow: string;
  commitment: string;
  accountAddress: string;
  evmAddress: string;
  relayer: string;
  now: bigint;
  /** Server-selected, never copied blindly from the request. */
  refundNote?: string;
}): Promise<string[]> {
  if (!Array.isArray(args.calldata) || args.calldata.length !== 17) {
    throw new Error("Intent must contain exactly one escrow claim");
  }
  const calldata = args.calldata.map(escrowClaimFelt);
  const v = calldata.map(BigInt);
  if (v[4] !== 1n || v[7] !== 2n || v[10] !== 6n) {
    throw new Error("Intent must contain exactly one escrow claim");
  }
  const entrypoint = args.refundNote === undefined ? "claim" : "authorize_refund";
  if (v[5] !== BigInt(args.escrow) || v[6] !== BigInt(hash.getSelectorFromName(entrypoint))) {
    throw new Error("Only this network's escrow claim is sponsored");
  }
  if (v[8] !== BigInt(args.commitment)) {
    throw new Error("Intent commitment does not match the escrow entry");
  }
  if (v[0] !== BigInt(args.relayer)) throw new Error("Intent must name this relayer");
  if (v[9] === 0n) throw new Error("Invalid claim destination or refund note");
  if (args.refundNote !== undefined) {
    if (v[9] !== BigInt(args.refundNote)) throw new Error("Refund note does not match the proof");
  } else if (v[9] === BigInt(args.escrow)) {
    throw new Error("Invalid claim destination");
  }
  if (args.refundNote === undefined) validateAndParseAddress(calldata[9]);
  if (v[2] >= UINT64_LIMIT || v[3] >= UINT64_LIMIT ||
      v[2] >= args.now || v[3] <= args.now || v[3] > args.now + MAX_INTENT_LIFETIME) {
    throw new Error("Intent must be executable now and expire within 15 minutes");
  }
  if (v.slice(11, 15).some((limb) => limb >= UINT128_LIMIT) ||
      (v[15] !== 27n && v[15] !== 28n) || v[16] === 0n) {
    throw new Error("Invalid Eth712 intent signature");
  }
  const typedData = eth712OutsideExecutionTypedData({
    accountAddress: args.accountAddress,
    snChainName: privacySdkOf(args.network).snChainName,
    evmChainId: v[16],
    intent: {
      caller: v[0], nonce: v[1], executeAfter: v[2], executeBefore: v[3],
      calls: [{ to: v[5], selector: v[6], calldata: [v[8], v[9]] }],
    },
  });
  const signature = serializeSignature({
    r: toHex((v[11] << 128n) | v[12], { size: 32 }),
    s: toHex((v[13] << 128n) | v[14], { size: 32 }),
    yParity: Number(v[15] - 27n),
  });
  const recovered = await recoverTypedDataAddress({ ...typedData, signature });
  if (recovered.toLowerCase() !== args.evmAddress.toLowerCase()) {
    throw new Error("Intent signature does not match the escrow owner");
  }
  return calldata;
}
