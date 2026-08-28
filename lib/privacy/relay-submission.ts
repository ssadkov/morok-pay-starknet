import {
  Account,
  RpcProvider,
  cairo,
  hash,
  validateAndParseAddress,
  type Call,
} from "starknet";

import type { AppNetwork } from "@/lib/network";
import { eth712FundedResourceBounds } from "@/lib/privacy/eth712-transaction";
import { privacySdkOf } from "@/lib/privacy/network";
import { readPublicStrkBalance } from "@/lib/privacy/onboarding-server";
import { starknetOf, STRK_ADDRESS } from "@/lib/starknet/constants";

/**
 * Submitting a donor's proven action set on their behalf.
 *
 * The pool runs no caller check on `apply_actions` - authorization is the
 * transaction's proof facts - and `collect_fee` charges
 * `get_caller_address()`. So MorokPay can send a donor's transfer and pay the
 * pool fee itself, and the donor's address never reaches the chain. Verified
 * on Sepolia by scripts/relay-probe.mjs: the relayed transaction named the
 * recipient and nobody else, and the donor's public balance did not move.
 *
 * That is the whole of "a donor must not be publicly linked to a QR". Only
 * the first transfer to a given recipient needs it - that one publishes
 * `Append { recipient_addr }` - so the client asks for a relay when the
 * channel is still missing, not on every donation.
 *
 * What this moves rather than removes: the correlation leaves the chain, where
 * it is public and permanent, and arrives here, where it is transient. This
 * module is deliberately given nothing that identifies the donor - no address,
 * no ownership signature - so that the most it can ever log is an IP and a
 * timestamp.
 */

export const APPLY_ACTIONS_SELECTOR = hash.getSelectorFromName("apply_actions");
/** `PROOF1` - the only proof-fact version the pool accepts today. */
export const PROOF1_VERSION = BigInt("0x50524f4f4631");

/** A proof is hundreds of kilobytes of base64; a megabyte is already absurd. */
const MAXIMUM_PROOF_CHARACTERS = 4_000_000;
const MAXIMUM_CALLDATA_FELTS = 4096;
const MAXIMUM_PROOF_FACTS = 64;

/** Gas the relayer will spend on one submission, over and above the pool fee. */
export const DEFAULT_RELAY_GAS_CAP = BigInt(12) * BigInt(10) ** BigInt(18);

/**
 * The relayer refuses work it cannot pay for in full, and that is the only
 * thing the floor should mean: the fee plus the gas cap for one submission.
 * A round reserve on top of that reads as prudent and is really just an
 * arbitrary number of donations refused while the balance is still there.
 */
export function relayFloor(poolFee: bigint, gasCap: bigint): bigint {
  return poolFee + gasCap;
}

export type RelayRequest = {
  call: Call;
  proof: string;
  proofFacts: string[];
};

function felt(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new RelayRejected(`${field} is not a felt`);
  }
  return value;
}

/** A request this relayer will not pay for. Always the caller's fault. */
export class RelayRejected extends Error {}

/**
 * Accepts exactly one shape: an `apply_actions` call on this network's pool,
 * carrying a PROOF1 proof. Anything else - another contract, another
 * entrypoint, a missing proof - is refused before it can cost a fee, because
 * the endpoint pays for whatever it submits.
 */
export function parseRelayRequest(
  body: unknown,
  network: AppNetwork,
): RelayRequest {
  const input = body as Record<string, unknown> | null;
  const call = input?.call as Record<string, unknown> | undefined;
  if (!call) throw new RelayRejected("No call to relay");

  const pool = BigInt(starknetOf(network).pool);
  let target: bigint;
  try {
    target = BigInt(validateAndParseAddress(String(call.contractAddress)));
  } catch {
    throw new RelayRejected("The call has no valid contract address");
  }
  if (target !== pool) {
    throw new RelayRejected(
      `This relayer only submits to the ${network} privacy pool`,
    );
  }

  const selector =
    typeof call.entrypoint === "string"
      ? hash.getSelectorFromName(call.entrypoint)
      : typeof call.selector === "string"
        ? call.selector
        : null;
  if (selector === null || BigInt(selector) !== BigInt(APPLY_ACTIONS_SELECTOR)) {
    throw new RelayRejected("This relayer only submits apply_actions");
  }

  const calldata = call.calldata;
  if (!Array.isArray(calldata) || calldata.length === 0) {
    throw new RelayRejected("The call carries no calldata");
  }
  if (calldata.length > MAXIMUM_CALLDATA_FELTS) {
    throw new RelayRejected("The call carries too much calldata");
  }

  const proof = input?.proof;
  if (typeof proof !== "string" || proof.length === 0) {
    throw new RelayRejected("The request carries no proof");
  }
  if (proof.length > MAXIMUM_PROOF_CHARACTERS) {
    throw new RelayRejected("The proof is too large");
  }

  const proofFacts = input?.proofFacts;
  if (!Array.isArray(proofFacts) || proofFacts.length === 0) {
    throw new RelayRejected("The request carries no proof facts");
  }
  if (proofFacts.length > MAXIMUM_PROOF_FACTS) {
    throw new RelayRejected("The request carries too many proof facts");
  }
  const facts = proofFacts.map((value, index) =>
    felt(value, `proofFacts[${index}]`),
  );
  if (BigInt(facts[0]) !== PROOF1_VERSION) {
    throw new RelayRejected("Unsupported proof version");
  }

  return {
    call: {
      contractAddress: validateAndParseAddress(String(call.contractAddress)),
      entrypoint: "apply_actions",
      calldata: calldata.map((value, index) => felt(value, `calldata[${index}]`)),
    },
    proof,
    proofFacts: facts,
  };
}

export type RelayerCredentials = {
  rpc: string;
  address: string;
  privateKey: string;
};

/**
 * Mainnet relaying stays off until it is switched on deliberately: every
 * submission costs the 6 STRK pool fee plus gas out of our own balance, and
 * nothing in the request identifies who asked for it.
 */
export function relayEnabled(network: AppNetwork): boolean {
  return network === "sepolia"
    ? process.env.MOROKPAY_SEPOLIA_RELAY_ENABLED !== "false"
    : process.env.MOROKPAY_MAINNET_RELAY_ENABLED === "true";
}

export function relayerCredentials(
  network: AppNetwork,
): RelayerCredentials | null {
  const address = (
    network === "mainnet"
      ? process.env.MOROKPAY_MAINNET_RELAYER_ADDRESS
      : process.env.MOROKPAY_SEPOLIA_RELAYER_ADDRESS
  )?.trim();
  const privateKey = (
    network === "mainnet"
      ? process.env.MOROKPAY_MAINNET_RELAYER_PRIVATE_KEY
      : process.env.MOROKPAY_SEPOLIA_RELAYER_PRIVATE_KEY
  )?.trim();
  if (!address || !privateKey) return null;
  /* Not starknetOf().rpc: a proof-carrying invoke needs an endpoint that
     speaks 0.10.3, and an older one silently drops `proof` and `proof_facts`
     until the pool answers EMPTY_PROOF_FACTS. */
  return { rpc: privacySdkOf(network).privacyRpcUrl, address, privateKey };
}

function approvalCall(poolAddress: string, amount: bigint): Call {
  const value = cairo.uint256(amount);
  return {
    contractAddress: STRK_ADDRESS,
    entrypoint: "approve",
    calldata: [poolAddress, value.low.toString(), value.high.toString()],
  };
}

export type RelayResult = {
  transactionHash: string;
  relayerAddress: string;
  poolFee: string;
};

/**
 * Submits the donor's proven call from the relayer account, with the relayer's
 * own STRK approval in front of it - the fee follows `get_caller_address()`,
 * so the approval has to come from the submitter, not from whoever built the
 * proof.
 */
export async function submitRelayed(args: {
  network: AppNetwork;
  request: RelayRequest;
  credentials: RelayerCredentials;
  poolFee: bigint;
  gasCap?: bigint;
  floor?: bigint;
}): Promise<RelayResult> {
  const provider = new RpcProvider({
    nodeUrl: args.credentials.rpc,
    specVersion: "0.10.3",
  });
  const relayer = new Account({
    provider,
    address: validateAndParseAddress(args.credentials.address),
    signer: args.credentials.privateKey,
  });

  const gasCap = args.gasCap ?? DEFAULT_RELAY_GAS_CAP;
  const balance = await readPublicStrkBalance(provider, relayer.address);
  const floor = args.floor ?? relayFloor(args.poolFee, gasCap);
  if (balance < floor) {
    throw new Error(
      `The ${args.network} relayer holds ${balance} wei, under the ${floor} one submission can cost`,
    );
  }

  const calls = [
    approvalCall(starknetOf(args.network).pool, args.poolFee),
    args.request.call,
  ];
  const proofDetails = {
    proof: args.request.proof,
    proofFacts: args.request.proofFacts,
  };
  const nonce = BigInt(await relayer.getNonce());
  const estimate = await relayer.estimateInvokeFee(calls, {
    nonce,
    skipValidate: true,
    tip: BigInt(0),
    ...proofDetails,
  });
  /* The account must cover the bound, not the eventual charge: on Sepolia a
     transfer estimated to ~6 STRK of L2 bounds and settled at 2.9. The cap is
     what stops one submission from draining the relayer. */
  const resourceBounds = eth712FundedResourceBounds({
    estimated: estimate.resourceBounds,
    publicBalance: balance,
    transferAmount: args.poolFee,
    maximumFeeCap: gasCap,
  });
  const submission = await relayer.execute(calls, {
    nonce,
    resourceBounds,
    tip: BigInt(0),
    ...proofDetails,
  });

  return {
    transactionHash: String(submission.transaction_hash),
    relayerAddress: relayer.address,
    poolFee: args.poolFee.toString(),
  };
}
