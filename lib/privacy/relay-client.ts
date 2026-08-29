import { num, validateAndParseAddress, type BigNumberish } from "starknet";

import type { AppNetwork } from "@/lib/network";

/**
 * The browser half of relayed submission: handing a proven action set to
 * MorokPay to send and pay for, and deciding when that is even needed.
 *
 * Shared by both wallet rails. The EVM rail builds the proof with the SDK in
 * page context; Ready X builds it inside the extension and hands it over through
 * `wallet_strk20PrepareInvoke`. Past that point the two are the same thing: a
 * call plus a proof that authorizes itself, which anybody can submit.
 */

export type RelayableCall = {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
};

/** The Wallet API returns snake_case calls; the SDK returns camelCase ones. */
export function normalizeCall(call: {
  contractAddress?: unknown;
  contract_address?: unknown;
  entrypoint?: unknown;
  entry_point?: unknown;
  calldata?: unknown;
}): RelayableCall {
  const address = call.contractAddress ?? call.contract_address;
  const entrypoint = call.entrypoint ?? call.entry_point;
  if (typeof address !== "string" || typeof entrypoint !== "string") {
    throw new Error("The wallet returned a call this app cannot read.");
  }
  return {
    contractAddress: validateAndParseAddress(address),
    entrypoint,
    calldata: ((call.calldata ?? []) as BigNumberish[]).map((value) =>
      num.toHex(value),
    ),
  };
}

/**
 * Whether this call publishes who is being paid.
 *
 * Only the first transfer to a given recipient carries the channel-opening
 * `Append`, and that is the one place the recipient's address appears in
 * plaintext calldata. Rather than ask the SDK whether a channel exists and
 * trust the answer, look at the assembled call for the address itself: that
 * measures the leak directly instead of predicting it, and it cannot be wrong
 * about a setup action nobody expected.
 */
export function namesRecipient(
  call: Pick<RelayableCall, "calldata">,
  recipient: string,
): boolean {
  const target = BigInt(validateAndParseAddress(recipient));
  return call.calldata.some((felt) => {
    try {
      return BigInt(felt) === target;
    } catch {
      return false;
    }
  });
}

/**
 * Hands a proven action set to MorokPay to submit and pay for.
 *
 * The point is what is *not* sent: no address, no signature, nothing that
 * names the donor. The pool authorizes on the proof alone, so the relayer can
 * send it without knowing whose it is - and the chain then records MorokPay as
 * the sender rather than the donor.
 *
 * There is deliberately no fallback to submitting it ourselves. Falling back
 * would quietly publish the very link the relay exists to break, and a donor
 * who was told the donation was unlinkable would never see it happen.
 */
export async function relaySubmission(args: {
  network: AppNetwork;
  call: RelayableCall;
  proof: string;
  proofFacts: string[];
}): Promise<{ transaction_hash: string }> {
  const response = await fetch("/api/privacy/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      network: args.network,
      call: args.call,
      proof: args.proof,
      proofFacts: args.proofFacts,
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    transactionHash?: string;
  } | null;
  if (!response.ok || !payload?.transactionHash) {
    throw new Error(
      payload?.error ??
        "MorokPay could not relay this donation, and it was not submitted. Nothing was published.",
    );
  }
  return { transaction_hash: payload.transactionHash };
}
