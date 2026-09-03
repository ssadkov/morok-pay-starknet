"use client";

import { useState } from "react";
import { ArrowDownIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { txToast } from "@/components/pay/tx-toast";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseTokenAmount } from "@/lib/amount";
import { swapUsdcToStrk } from "@/lib/avnu/swap-flow";
import { describeError } from "@/lib/starknet/errors";
import { formatStrk, formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

/**
 * Buying the STRK that every private action costs, out of the USDC the user
 * already has.
 *
 * The pool charges its fee in STRK and the chain charges gas in it, so a
 * balance that is all USDC can do nothing private at all. Until now the only
 * answer was to go buy STRK somewhere else, which is where people leave. This
 * is the same answer without the detour: AVNU routes across the Starknet AMMs,
 * and the swap is an ordinary public transaction - no proof, no pool, no
 * privacy claim attached to it.
 *
 * The quote is fetched fresh at submit rather than reused from what is on
 * screen. AVNU expires them, and a stale quote is refused at build time, so
 * re-asking is both cheaper and more honest than showing a number that may no
 * longer hold.
 */

/** A swap that leaves the account unable to pay for the next thing is a trap. */
const SUGGESTED_STRK = BigInt(25) * BigInt(10) ** BigInt(18);

/**
 * What the swap itself burns, measured on mainnet (2.04 STRK for a two-call
 * approve-and-route). Quoted output is gross, so a small swap can hand over
 * less STRK than it costs to perform - showing the gross number alone would
 * be the one dishonest thing on a page about costs.
 */
const SWAP_GAS_STRK = BigInt(21) * BigInt(10) ** BigInt(17);

export function SwapPanel() {
  const { session, balances, refreshBalances } = useTreasury();
  const { network, starknet } = useNetwork();
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<{ buy: bigint; source: string | null } | null>(
    null,
  );
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);

  const usdc = getShieldToken("usdc", network);
  const publicUsdc = balances?.usdcRaw ?? BigInt(0);
  const publicStrk = balances?.strkWei ?? BigInt(0);
  const supported = network === "mainnet";
  /* Below the gas a swap burns there is nothing to submit with, which is
     exactly the state someone is in right after bridging. */
  const gasless = session?.kind === "evm" && publicStrk < SWAP_GAS_STRK;

  async function ask(sellAmount: bigint) {
    const response = await fetch("/api/swap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "quote",
        network,
        sellAmount: sellAmount.toString(),
        takerAddress: session?.address,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error ?? "AVNU did not quote this");
    return body as { quoteId: string; buyAmount: string; liquiditySource: string | null };
  }

  async function refreshQuote() {
    setQuote(null);
    let sellAmount: bigint;
    try {
      sellAmount = parseTokenAmount(amount, usdc.decimals);
    } catch {
      return;
    }
    if (sellAmount <= BigInt(0)) return;
    setQuoting(true);
    try {
      const answer = await ask(sellAmount);
      setQuote({
        buy: BigInt(answer.buyAmount),
        source: answer.liquiditySource,
      });
    } catch (error) {
      toast.error(describeError(error) || "Could not get a quote");
    } finally {
      setQuoting(false);
    }
  }

  async function swap() {
    if (!session) return;
    setSwapping(true);
    try {
      const sellAmount = parseTokenAmount(amount, usdc.decimals);
      if (sellAmount <= BigInt(0)) throw new Error("Enter an amount to swap");
      if (sellAmount > publicUsdc) {
        throw new Error(`Only ${formatUsdc(publicUsdc)} public USDC is available`);
      }

      const hash = await swapUsdcToStrk({
        network,
        session: {
          address: session.address,
          kind: session.kind,
          account: session.account,
        },
        sellAmount,
        gasless,
      });
      if (hash) {
        txToast({
          title: `Swapped ${formatUsdc(sellAmount)} USDC for STRK`,
          txHash: hash,
          explorerUrl: `${starknet.explorer}/tx/${hash}`,
          explorerLabel: "Voyager",
        });
      } else {
        toast.success(`Swapped ${formatUsdc(sellAmount)} USDC for STRK`);
      }
      setAmount("");
      setQuote(null);
      await refreshBalances({ private: false });
    } catch (error) {
      toast.error(describeError(error) || "The swap failed");
    } finally {
      setSwapping(false);
    }
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Buy STRK with USDC</CardTitle>
        <CardDescription>
          Every private action costs STRK - a fixed pool fee plus gas - so a
          balance that is all USDC cannot shield, send or withdraw. This buys
          that STRK from the USDC you already hold, routed through AVNU across
          the Starknet AMMs.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!session ? (
          <p className="text-sm text-muted-foreground">
            Connect Ready X or an EVM wallet first.
          </p>
        ) : !supported ? (
          <Alert>
            <AlertTitle>Mainnet only</AlertTitle>
            <AlertDescription>
              There is no Sepolia liquidity worth routing against. Switch the
              header to Mainnet.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="rounded-xl bg-muted/40 px-3 py-3 ring-1 ring-foreground/10">
              <p className="font-mono text-sm tabular-nums">
                {formatUsdc(publicUsdc)} USDC
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                public balance · {formatStrk(publicStrk)} STRK for fees
              </p>
            </div>

            <Field>
              <FieldLabel htmlFor="swap-amount">USDC to spend</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="swap-amount"
                  value={amount}
                  inputMode="decimal"
                  placeholder="0.00"
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setQuote(null);
                  }}
                  onBlur={() => void refreshQuote()}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={quoting}
                  aria-label="Refresh the quote"
                  onClick={() => void refreshQuote()}
                >
                  {quoting ? (
                    <Spinner />
                  ) : (
                    <RefreshCwIcon />
                  )}
                </Button>
              </div>
              <FieldDescription>
                About 1 USDC covers a pool fee and gas at today&apos;s price.
                Spending {formatUsdc(BigInt(2) * BigInt(10) ** BigInt(usdc.decimals))} USDC
                leaves room for a shield and a withdrawal too.
              </FieldDescription>
            </Field>

            <div className="flex items-center justify-center text-muted-foreground">
              <ArrowDownIcon className="size-4" />
            </div>

            <div className="rounded-xl bg-muted/40 px-3 py-3 ring-1 ring-foreground/10">
              <p className="font-mono text-sm tabular-nums">
                {quote ? `${formatStrk(quote.buy)} STRK` : "—"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {quote
                  ? `via ${quote.source ?? "AVNU"} · fills within 1% of this or reverts`
                  : "enter an amount to see the rate"}
              </p>
              {quote ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Roughly {formatStrk(SWAP_GAS_STRK)} STRK of it pays for this
                  swap, so you keep about{" "}
                  {formatStrk(
                    quote.buy > SWAP_GAS_STRK
                      ? quote.buy - SWAP_GAS_STRK
                      : BigInt(0),
                  )}
                  .
                </p>
              ) : null}
            </div>

            {quote && quote.buy < SWAP_GAS_STRK * BigInt(2) ? (
              <Alert>
                <AlertTitle>Too small to be worth it</AlertTitle>
                <AlertDescription>
                  Gas would eat most of what this buys. Swap enough to matter -
                  around 1 USDC leaves comfortably more STRK than a full
                  activation and withdrawal need.
                </AlertDescription>
              </Alert>
            ) : null}

            {gasless ? (
              <Alert>
                <AlertTitle>Paid for out of the swap</AlertTitle>
                <AlertDescription>
                  This account holds no STRK to submit with, so AVNU submits
                  the swap and takes its cost from the USDC instead. You sign,
                  you do not pay gas.
                </AlertDescription>
              </Alert>
            ) : null}

            {!gasless && publicStrk < SUGGESTED_STRK ? (
              <FieldDescription>
                Holding {formatStrk(publicStrk)} STRK. Around{" "}
                {formatStrk(SUGGESTED_STRK)} covers activation and a withdrawal
                later without topping up twice.
              </FieldDescription>
            ) : null}
          </>
        )}
      </CardContent>

      {session && supported ? (
        <CardFooter className="border-t">
          <Button
            type="button"
            size="lg"
            className="min-h-12"
            disabled={swapping || !amount.trim() || publicUsdc <= BigInt(0)}
            aria-busy={swapping}
            onClick={() => void swap()}
          >
            {swapping ? <Spinner data-icon="inline-start" /> : null}
            {swapping ? "Swapping…" : "Swap to STRK"}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
