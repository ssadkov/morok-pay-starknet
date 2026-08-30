import type { Call } from "starknet";

import type { AppNetwork } from "@/lib/network";

/**
 * The half of onboarding that does not need a wallet the user does not have.
 *
 * Someone arriving with USDC - bridged, or withdrawn from an exchange - still
 * cannot do anything private until they hold STRK, because the pool charges
 * its fee in STRK and the chain charges gas in it. Sending them off to buy an
 * unrelated token is the largest drop-off in this path. AVNU aggregates the
 * Starknet AMMs, so a slice of the USDC they already have can become that STRK
 * without leaving the app.
 *
 * AVNU builds the calls itself, which is why nothing here assembles a route:
 * `/swap/v2/build` returns the approve and the `multi_route_swap` ready to
 * submit, so a route this file does not understand cannot be mis-encoded.
 */

const BASE_URL: Partial<Record<AppNetwork, string>> = {
  mainnet: "https://starknet.api.avnu.fi",
};

export type SwapQuote = {
  quoteId: string;
  sellAmount: bigint;
  buyAmount: bigint;
  sellAmountUsd: number | null;
  buyAmountUsd: number | null;
  /** Gas AVNU expects the swap itself to burn, in wei of STRK. */
  gasFees: bigint;
  avnuFeesBps: number;
  integratorFeesBps: number;
  liquiditySource: string | null;
  expiry: number | null;
};

export class AvnuUnavailableError extends Error {}

/** AVNU quotes only where there is liquidity to quote against. */
export function swapSupported(network: AppNetwork): boolean {
  return Boolean(BASE_URL[network]);
}

function baseUrl(network: AppNetwork): string {
  const url = BASE_URL[network];
  if (!url) {
    throw new AvnuUnavailableError(
      `MorokPay does not swap on ${network}. Switch to Mainnet.`,
    );
  }
  return url;
}

async function avnu(network: AppNetwork, path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl(network)}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new AvnuUnavailableError("AVNU did not answer. Try again in a moment.");
  }
  if (!response.ok) {
    const body = await response.text();
    throw new AvnuUnavailableError(
      `AVNU refused the request (${response.status}). ${body.slice(0, 200)}`,
    );
  }
  return response.json();
}

const toBigInt = (value: unknown): bigint => {
  if (typeof value === "string") return BigInt(value);
  if (typeof value === "number") return BigInt(Math.trunc(value));
  return BigInt(0);
};

const toNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Asks what a given amount of `sellToken` buys. Quotes expire, and `build`
 * refuses a stale one, so a quote is fetched fresh right before submitting
 * rather than held while the user reads it.
 */
export async function quoteSwap(args: {
  network: AppNetwork;
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  takerAddress?: string;
}): Promise<SwapQuote> {
  const params = new URLSearchParams({
    sellTokenAddress: args.sellToken,
    buyTokenAddress: args.buyToken,
    sellAmount: `0x${args.sellAmount.toString(16)}`,
    size: "1",
  });
  if (args.takerAddress) params.set("takerAddress", args.takerAddress);

  const quotes = await avnu(args.network, `/swap/v2/quotes?${params}`);
  const quote = Array.isArray(quotes) ? quotes[0] : null;
  if (!quote?.quoteId) {
    throw new AvnuUnavailableError(
      "No route for this amount. Try a different size.",
    );
  }
  return {
    quoteId: String(quote.quoteId),
    sellAmount: toBigInt(quote.sellAmount),
    buyAmount: toBigInt(quote.buyAmount),
    sellAmountUsd: toNumber(quote.sellAmountInUsd),
    buyAmountUsd: toNumber(quote.buyAmountInUsd),
    gasFees: toBigInt(quote.gasFees),
    avnuFeesBps: toNumber(quote.avnuFeesBps) ?? 0,
    integratorFeesBps: toNumber(quote.integratorFeesBps) ?? 0,
    liquiditySource:
      typeof quote.liquiditySource === "string" ? quote.liquiditySource : null,
    expiry: toNumber(quote.expiry),
  };
}

/**
 * Turns a quote into the calls that execute it. Slippage is a floor written
 * into `multi_route_swap` itself, so a route that moves against the user
 * between building and landing reverts rather than filling badly.
 */
export async function buildSwapCalls(args: {
  network: AppNetwork;
  quoteId: string;
  takerAddress: string;
  slippage: number;
  integratorFeeBps?: number;
  integratorFeeRecipient?: string;
}): Promise<Call[]> {
  const body: Record<string, unknown> = {
    quoteId: args.quoteId,
    takerAddress: args.takerAddress,
    slippage: args.slippage,
    includeApprove: true,
  };
  /* Both or neither: AVNU charges the fee to whoever is named, so a bps
     without a recipient would quietly become nobody's. */
  if (args.integratorFeeBps && args.integratorFeeRecipient) {
    body.integratorFees = `0x${args.integratorFeeBps.toString(16)}`;
    body.integratorFeeRecipient = args.integratorFeeRecipient;
    body.integratorName = "MorokPay";
  }

  const built = await avnu(args.network, "/swap/v2/build", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const calls = Array.isArray(built?.calls) ? built.calls : null;
  if (!calls?.length) {
    throw new AvnuUnavailableError("AVNU returned no calls for this quote.");
  }
  return calls.map((call: Record<string, unknown>) => ({
    contractAddress: String(call.contractAddress),
    entrypoint: String(call.entrypoint),
    calldata: (call.calldata as string[]) ?? [],
  }));
}
