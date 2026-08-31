import type { Call } from "starknet";

import type { AppNetwork } from "@/lib/network";
import type { MorokPrivateAccount } from "@/lib/privacy/evm-strk20-account";

/**
 * Buying STRK with USDC, from wherever it is asked for.
 *
 * The onboarding screen and the standalone Get STRK page both need this, and
 * they need it to behave identically - one of them is where a first-time user
 * meets it, and a second implementation would be a second set of bugs. So the
 * decision that matters lives here: whether the account can submit the swap
 * itself, or whether it holds no STRK at all and the swap has to pay for its
 * own submission.
 */

export type SwapExecutor = {
  address: string;
  kind: "ready" | "evm";
  account: {
    execute: (calls: Call[]) => Promise<{ transaction_hash?: string } | unknown>;
    signOutsideExecution?: MorokPrivateAccount["signOutsideExecution"];
  };
};

async function post<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json();
  if (!response.ok) {
    throw new Error(parsed?.error ?? "The swap router refused this");
  }
  return parsed as T;
}

export async function quoteUsdcToStrk(args: {
  network: AppNetwork;
  sellAmount: bigint;
  takerAddress?: string;
}) {
  return post<{
    quoteId: string;
    buyAmount: string;
    liquiditySource: string | null;
  }>({
    action: "quote",
    network: args.network,
    sellAmount: args.sellAmount.toString(),
    takerAddress: args.takerAddress,
  });
}

/**
 * Runs the swap and returns the transaction hash.
 *
 * `gasless` is not an option the caller picks for flavour - it is forced by
 * the account holding less STRK than a submission burns, which is exactly the
 * state a bridged account starts in. In that case AVNU submits and charges the
 * USDC; otherwise the account submits and pays as usual.
 */
export async function swapUsdcToStrk(args: {
  network: AppNetwork;
  session: SwapExecutor;
  sellAmount: bigint;
  gasless: boolean;
  /**
   * Ceiling for what the paymaster may bill, in the sell token. Left unset it
   * falls back to the router's default, which is only safe when the account
   * holds comfortably more than it is selling.
   */
  gasBudget?: bigint;
  onProgress?: (step: string) => void;
}): Promise<string> {
  const progress = args.onProgress ?? (() => {});

  progress("Getting a rate");
  const quote = await quoteUsdcToStrk({
    network: args.network,
    sellAmount: args.sellAmount,
    takerAddress: args.session.address,
  });

  const { calls } = await post<{ calls: Call[] }>({
    action: "build",
    network: args.network,
    quoteId: quote.quoteId,
    takerAddress: args.session.address,
    slippage: 0.01,
  });

  if (!args.gasless) {
    progress("Confirm the swap in your wallet");
    const response = await args.session.account.execute(calls);
    return String(
      (response as { transaction_hash?: string })?.transaction_hash ?? "",
    );
  }

  const sign = args.session.account.signOutsideExecution;
  if (args.session.kind !== "evm" || !sign) {
    throw new Error(
      "This wallet cannot swap without STRK. Send it a little STRK for gas first.",
    );
  }

  const composed = await post<{
    intent: Parameters<typeof sign>[0];
    typedData: unknown;
  }>({
    action: "sponsor",
    network: args.network,
    takerAddress: args.session.address,
    calls,
    maxGasTokenAmount: args.gasBudget?.toString(),
  });

  progress("Approve the gasless swap");
  const signed = await sign(composed.intent);

  /* AVNU's own typed data goes back, not the one just signed. The account
     rebuilds the hash from the struct either way, and ours carries bigints
     that JSON cannot even carry. */
  progress("AVNU is submitting it");
  const { transactionHash } = await post<{ transactionHash: string }>({
    action: "submit",
    network: args.network,
    takerAddress: args.session.address,
    typedData: composed.typedData,
    signature: signed.signature,
  });
  return transactionHash;
}
