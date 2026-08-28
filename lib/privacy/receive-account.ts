import { CallData, ec, hash, num, type Call } from "starknet";
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
      ],
    },
    primaryType: "ReceiveAccount" as const,
    message: {
      purpose: "Derive the MorokPay account your donation QR publishes",
      evmAccount: args.evmAddress,
      starknetChain: sdk.snChainName,
      privacyPool: BigInt(sdk.poolAddress),
    },
  } as const;
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
