import { concat, keccak256, toHex, type Address, type Hex } from "viem";
import { CallData, ec, hash, num } from "starknet";

import {
  ACCOUNT_ACTION,
  ACCOUNT_KEY_DOMAIN,
  OZ_ACCOUNT_CLASS_HASH,
  STARK_CURVE_ORDER,
  VIEWING_KEY_DOMAIN,
} from "./constants";

export type DerivedTreasury = {
  owner: Address;
  /** Stark private key. Keep in memory only — never persist or render. */
  privateKey: Hex;
  publicKey: Hex;
  address: Hex;
  viewingKey: bigint;
};

/**
 * Chain-independent personal_sign payload. EIP-712 would bind `chainId` to
 * whatever network MetaMask is on, so the same owner would get a different
 * Starknet account on Base vs Ethereum.
 */
export function accountDerivationMessage(owner: Address): string {
  return [
    "MorokPay opens a hidden Starknet treasury for this Ethereum account.",
    "This signature does not spend funds.",
    "",
    `action: ${ACCOUNT_ACTION}`,
    `owner: ${owner.toLowerCase()}`,
  ].join("\n");
}

function toFeltHex(value: string): Hex {
  const stripped = value.replace(/^0x/i, "");
  return `0x${stripped}`;
}

function utf8Hex(value: string): Hex {
  return toHex(new TextEncoder().encode(value));
}

/**
 * Grind a personal_sign signature into a Stark curve private key.
 *
 * MetaMask `personal_sign` is RFC6979-deterministic for the same
 * account + payload, so the user recovers the same treasury after refresh
 * by signing again. The signature itself is the seed — never log it.
 *
 * This is a hackathon companion-account pattern, not an audited KDF.
 * Production should prefer a SNIP-6 account that verifies the source
 * wallet signature directly.
 */
export function starkPrivateKeyFromSignature(signature: Hex): Hex {
  const seed = keccak256(concat([signature, utf8Hex(ACCOUNT_KEY_DOMAIN)]));
  return toFeltHex(ec.starkCurve.grindKey(seed));
}

export function starkPublicKeyFromPrivate(privateKey: Hex): Hex {
  return toFeltHex(ec.starkCurve.getStarkKey(privateKey));
}

export function ozConstructorCalldata(publicKey: Hex) {
  return CallData.compile({ publicKey });
}

export function computeOzAccountAddress(publicKey: Hex): Hex {
  return hash.calculateContractAddressFromHash(
    publicKey,
    OZ_ACCOUNT_CLASS_HASH,
    ozConstructorCalldata(publicKey),
    0,
  ) as Hex;
}

/**
 * Viewing key used by the STRK20 Privacy SDK.
 * Derived from the Stark spending key so a second MetaMask popup is not
 * required for the first demo. Domain-separated from the account seed.
 */
export function deriveViewingKey(privateKey: Hex): bigint {
  const n = STARK_CURVE_ORDER;
  const domain = hash.starknetKeccak(VIEWING_KEY_DOMAIN);
  const hashed = hash.computePedersenHash(domain, privateKey);
  return (BigInt(hashed) % (n / BigInt(2))) + BigInt(1);
}

export function deriveTreasuryFromSignature(
  owner: Address,
  signature: Hex,
): DerivedTreasury {
  const privateKey = starkPrivateKeyFromSignature(signature);
  const publicKey = starkPublicKeyFromPrivate(privateKey);
  const address = computeOzAccountAddress(publicKey);
  const viewingKey = deriveViewingKey(privateKey);

  return {
    owner,
    privateKey,
    publicKey,
    address,
    viewingKey,
  };
}

export function viewingKeyPublicHex(viewingKey: bigint): Hex {
  return num.toHex(viewingKey) as Hex;
}
