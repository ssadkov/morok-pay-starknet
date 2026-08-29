import {
  CallData,
  ec,
  hash,
  num,
  type Call,
  type Signature,
  type TypedData,
} from "starknet";
import { keccak256, type Address, type Hex } from "viem";

import type { AppNetwork } from "@/lib/network";
import { privacySdkOf } from "@/lib/privacy/network";

/**
 * The address a creator publishes on their QR.
 *
 * A donation names its recipient in plaintext the first time anyone pays it,
 * so whatever the QR carries becomes public knowledge tied to that QR. If
 * that is the creator's main account, every donation page they ever share
 * points at the account holding everything else they own. So the QR carries a
 * separate receive account - `B` - and the main one - `A` - stays unpublished.
 *
 * `B` is not a second wallet to manage. Its key derives from one signature by
 * `A`, deterministically: the same wallet on any device reproduces the same
 * account, and losing this app loses nothing.
 *
 * One `B` serves every QR a creator publishes, and its shielded notes are one
 * balance - nothing in a note says which QR brought it, so per-QR totals do
 * not exist and cannot be added later by reading the chain differently. A
 * creator who wants them needs a separate account per QR, which is what
 * `index` is for: index 0 is the account every creator gets, and higher ones
 * are free to add without moving it.
 *
 * What keeps `A` and `B` apart on chain is that `A` never pays for anything
 * `B` does. A single STRK top-up from `A` would tie them together in public
 * and permanently - which is why the relayer deploys `B` and registers it,
 * and why the sweep out of `B` is relayed too.
 */

/** OpenZeppelin Account v1.0.0, declared on both mainnet and Sepolia. */
export const RECEIVE_ACCOUNT_CLASS_HASH =
  "0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

/** The classic Universal Deployer, deployed at the same address on both. */
export const UDC_ADDRESS =
  "0x041a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf";

/**
 * The one signature `B` comes from.
 *
 * Bound to the network's pool so a creator's Sepolia receive account and their
 * mainnet one are different accounts - a testnet key that leaked must not be
 * the key holding real donations. `purpose` says what signing does in words
 * the wallet will show.
 */
export function receiveAccountTypedData(args: {
  evmAddress: Address;
  evmChainId: number;
  network: AppNetwork;
  /** 0 is the creator's account. Reserved so per-QR accounts stay possible. */
  index?: number;
}) {
  const sdk = privacySdkOf(args.network);
  return {
    domain: {
      name: "MorokPay Receive Account",
      version: "1",
      chainId: args.evmChainId,
    },
    types: {
      ReceiveAccount: [
        { name: "purpose", type: "string" },
        { name: "evmAccount", type: "address" },
        { name: "starknetChain", type: "string" },
        { name: "privacyPool", type: "uint256" },
        { name: "index", type: "uint256" },
      ],
    },
    primaryType: "ReceiveAccount" as const,
    message: {
      purpose: "Derive the MorokPay account your donation QR publishes",
      evmAccount: args.evmAddress,
      starknetChain: sdk.snChainName,
      privacyPool: BigInt(sdk.poolAddress),
      index: BigInt(args.index ?? 0),
    },
  } as const;
}

/**
 * The Ready X-side attempt at the same signature.
 *
 * MetaMask's EIP-712 signing is known deterministic - the current viewing-key
 * derivation depends on it, and would break on every reconnect if it weren't.
 * A Starknet wallet's SNIP-12 `signMessage` has never been exercised for this
 * purpose here, and unlike an EOA's ECDSA it is not guaranteed deterministic
 * by the curve alone - it is whatever the wallet's own signer does with the
 * message, and for a guardian-backed account there is more than one key that
 * could be doing the signing.
 *
 * So this is checked, not assumed: sign the same message twice and compare.
 * A match means the account this derives is recoverable on any device, same
 * as the MetaMask one. A mismatch means it is not, and none should be created
 * - a `B` nobody can rederive is worse than no `B`, because donations would
 * still land on it.
 */
export function readyReceiveAccountTypedData(args: {
  network: AppNetwork;
  /** 0 is the creator's account. Reserved so per-QR accounts stay possible. */
  index?: number;
}): TypedData {
  const sdk = privacySdkOf(args.network);
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      ReadyReceiveAccount: [
        { name: "purpose", type: "string" },
        { name: "starknetChain", type: "shortstring" },
        { name: "privacyPool", type: "ContractAddress" },
        { name: "index", type: "felt" },
      ],
    },
    primaryType: "ReadyReceiveAccount",
    domain: {
      name: "MorokPay Receive Account",
      version: "1",
      chainId: sdk.snChainName,
      revision: "1",
    },
    message: {
      purpose: "Derive the MorokPay account your donation QR publishes",
      starknetChain: sdk.snChainName,
      privacyPool: sdk.poolAddress,
      index: String(args.index ?? 0),
    },
  };
}

/**
 * Turns whatever a wallet returned from `signMessage` into one blob of
 * entropy. A Starknet signature arrives as an array of felts (typically
 * `[r, s]`, more for a guardian-backed account) rather than the single byte
 * string an EOA produces - concatenated, each felt padded to 32 bytes so the
 * boundaries cannot shift and change the result.
 */
export function signatureEntropy(signature: Signature): Hex {
  const felts = Array.isArray(signature)
    ? signature
    : [signature.r, signature.s];
  return `0x${felts
    .map((felt) => BigInt(felt).toString(16).padStart(64, "0"))
    .join("")}`;
}

/** Whether two signature attempts over the same message actually agree. */
export function signaturesMatch(a: Signature, b: Signature): boolean {
  const feltsOf = (signature: Signature) =>
    Array.isArray(signature) ? signature : [signature.r, signature.s];
  const left = feltsOf(a);
  const right = feltsOf(b);
  if (left.length !== right.length) return false;
  return left.every((felt, index) => BigInt(felt) === BigInt(right[index]));
}

export type ReceiveAccount = {
  /** Never leaves the browser; it is re-derived from the signature on demand. */
  privateKey: string;
  publicKey: string;
  address: string;
};

/**
 * Turns the signature into a Starknet key.
 *
 * keccak reduces the 65-byte signature to one field, and `grindKey` maps that
 * onto the STARK curve order without the modulo bias that taking the hash
 * directly would leave. Both are deterministic, so the account is recoverable
 * from the wallet alone.
 */
export function deriveReceiveAccount(signature: Hex): ReceiveAccount {
  const privateKey = num.toHex(
    BigInt(`0x${ec.starkCurve.grindKey(keccak256(signature))}`),
  );
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  return {
    privateKey,
    publicKey,
    address: receiveAccountAddress(publicKey),
  };
}

/**
 * Where that key's account lives.
 *
 * Deployer address 0 on purpose: the UDC computes this same address when
 * asked for a non-unique deployment, so the address depends on the key alone.
 * MorokPay can therefore deploy `B` on the creator's behalf without the
 * address changing, and a creator who later deploys it themselves lands on
 * the same one.
 */
export function receiveAccountAddress(publicKey: string): string {
  return num.toHex(
    BigInt(
      hash.calculateContractAddressFromHash(
        publicKey,
        RECEIVE_ACCOUNT_CLASS_HASH,
        CallData.compile({ publicKey }),
        0,
      ),
    ),
  );
}

/** The relayer's deployment call. `unique = 0` keeps the address key-derived. */
export function receiveAccountDeployCall(publicKey: string): Call {
  return {
    contractAddress: UDC_ADDRESS,
    entrypoint: "deployContract",
    calldata: CallData.compile({
      classHash: RECEIVE_ACCOUNT_CLASS_HASH,
      salt: publicKey,
      unique: "0",
      calldata: [publicKey],
    }),
  };
}
