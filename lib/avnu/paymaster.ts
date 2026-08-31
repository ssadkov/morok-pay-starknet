import type { Call } from "starknet";

import type { AppNetwork } from "@/lib/network";
import type { OutsideExecutionIntent } from "@/lib/privacy/eth712-outside-execution";

/**
 * AVNU's paymaster: somebody else pays the STRK, the user pays in USDC.
 *
 * This is the half the swap page could not do on its own. Buying STRK with
 * USDC still needed STRK to submit, which is useless to the person the page
 * exists for - someone who just bridged and holds nothing but USDC. AVNU
 * relays the transaction and takes its cost out of a gas token, and our USDC
 * is on their gas-token list.
 *
 * The signature is ours to build, not theirs. AVNU returns SNIP-12 typed data
 * because it expects a Starknet-native wallet; our account class rebuilds the
 * hash itself as EIP-712 over the EVM chain id. Both describe the same
 * OutsideExecution struct, so we take their struct, sign it our way, and hand
 * the result back - see lib/privacy/eth712-outside-execution.ts.
 */

const BASE_URL: Partial<Record<AppNetwork, string>> = {
  mainnet: "https://starknet.api.avnu.fi",
};

export class PaymasterError extends Error {}

export type PaymasterIntent = OutsideExecutionIntent;

/**
 * What comes back from composing an intent: the struct to sign, and the
 * paymaster's own typed data untouched.
 *
 * The typed data is carried rather than rebuilt because it goes straight back
 * to AVNU on submit and only has to match what AVNU issued. Ours is a
 * different encoding of the same struct - EIP-712 where theirs is SNIP-12 -
 * and it exists only to be hashed and signed locally. It also holds bigints,
 * so it cannot cross a JSON boundary at all.
 */
export type PaymasterComposition = {
  intent: PaymasterIntent;
  typedData: unknown;
};

function baseUrl(network: AppNetwork) {
  const url = BASE_URL[network];
  if (!url) throw new PaymasterError(`No paymaster on ${network}.`);
  return url;
}

async function paymaster(network: AppNetwork, path: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl(network)}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(process.env.AVNU_PAYMASTER_API_KEY
          ? { "api-key": process.env.AVNU_PAYMASTER_API_KEY }
          : {}),
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new PaymasterError("The paymaster did not answer. Try again.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = Array.isArray(body?.messages)
      ? body.messages.join("; ")
      : (body?.message ?? `HTTP ${response.status}`);
    throw new PaymasterError(String(detail).slice(0, 300));
  }
  return body;
}

/**
 * Asks the paymaster to compose the intent. Everything that pins it down -
 * the caller it will submit through, the nonce, the validity window - is
 * decided here, and the user signs exactly this and nothing else.
 */
export async function buildPaymasterIntent(args: {
  network: AppNetwork;
  accountAddress: string;
  calls: Call[];
  gasToken: string;
  maxGasTokenAmount: bigint;
}): Promise<PaymasterComposition> {
  const built = await paymaster(args.network, "/paymaster/v1/build-typed-data", {
    method: "POST",
    body: JSON.stringify({
      userAddress: args.accountAddress,
      gasTokenAddress: args.gasToken,
      maxGasTokenAmount: `0x${args.maxGasTokenAmount.toString(16)}`,
      calls: args.calls.map((call) => ({
        contractAddress: call.contractAddress,
        entrypoint: call.entrypoint,
        calldata: call.calldata,
      })),
    }),
  });

  const message = built?.message;
  const rawCalls = message?.Calls ?? message?.calls;
  if (!message || !Array.isArray(rawCalls)) {
    throw new PaymasterError("The paymaster returned an intent we cannot read.");
  }
  return {
    typedData: built,
    intent: {
      caller: String(message.Caller ?? message.caller),
      nonce: String(message.Nonce ?? message.nonce),
      executeAfter: String(message["Execute After"] ?? message.execute_after),
      executeBefore: String(message["Execute Before"] ?? message.execute_before),
      calls: rawCalls.map((call: Record<string, unknown>) => ({
        to: String(call.To ?? call.to),
        selector: String(call.Selector ?? call.selector),
        calldata: ((call.Calldata ?? call.calldata) as string[]) ?? [],
      })),
    },
  };
}

/** Hands the signed intent back for AVNU to submit and pay for. */
export async function executePaymasterIntent(args: {
  network: AppNetwork;
  accountAddress: string;
  typedData: unknown;
  signature: string[];
}): Promise<string> {
  const result = await paymaster(args.network, "/paymaster/v1/execute", {
    method: "POST",
    body: JSON.stringify({
      userAddress: args.accountAddress,
      typedData: JSON.stringify(args.typedData),
      signature: args.signature,
    }),
  });
  const hash = result?.transactionHash ?? result?.transaction_hash;
  if (typeof hash !== "string") {
    throw new PaymasterError("The paymaster accepted nothing back.");
  }
  return hash;
}
