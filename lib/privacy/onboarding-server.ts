import {
  getAddress,
  isAddress,
  recoverMessageAddress,
  type Address,
  type Hex,
} from "viem";
import {
  RpcProvider,
  validateAndParseAddress,
  type BigNumberish,
} from "starknet";

import { STRK_ADDRESS } from "@/lib/starknet/constants";

import { OWNERSHIP_MESSAGE } from "./eth712-account";

const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/;

export type VerifiedOwnership = {
  evmAddress: Address;
  signature: Hex;
};

export async function verifyOwnershipRequest(
  value: unknown,
): Promise<VerifiedOwnership> {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid onboarding request");
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.evmAddress !== "string" ||
    !isAddress(body.evmAddress) ||
    typeof body.signature !== "string" ||
    !SIGNATURE_RE.test(body.signature)
  ) {
    throw new Error("Invalid onboarding ownership proof");
  }

  const evmAddress = getAddress(body.evmAddress);
  const signature = body.signature as Hex;
  const recovered = await recoverMessageAddress({
    message: OWNERSHIP_MESSAGE,
    signature,
  });
  if (recovered.toLowerCase() !== evmAddress.toLowerCase()) {
    throw new Error("Ownership signature does not match the EVM account");
  }
  return { evmAddress, signature };
}
function u256(low: BigNumberish, high: BigNumberish = 0): bigint {
  return BigInt(low) + (BigInt(high) << 128n);
}

export async function readPublicStrkBalance(
  provider: RpcProvider,
  address: string,
): Promise<bigint> {
  const result = await provider.callContract({
    contractAddress: STRK_ADDRESS,
    entrypoint: "balance_of",
    calldata: [validateAndParseAddress(address)],
  });
  const values = Array.isArray(result)
    ? result
    : ((result as { result?: string[] }).result ?? []);
  return u256(values[0] ?? 0, values[1] ?? 0);
}

export function parseWholeStrk(
  value: string | undefined,
  fallback: bigint,
): bigint {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value) || BigInt(value) > 1_000n) {
    throw new Error("Invalid whole-STRK server configuration");
  }
  return BigInt(value) * 10n ** 18n;
}
