"use client";

import { useState } from "react";
import { DicesIcon, EyeOffIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { txToast } from "@/components/pay/tx-toast";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parseUsdc } from "@/lib/amount";
import { recordActivity } from "@/lib/pay/activity";
import { jitterUnshieldAmount } from "@/lib/pay/jitter";
import { payoutToken } from "@/lib/starknet/actions";
import { formatStrk20Error } from "@/lib/starknet/errors";
import { formatStrk, formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";
import { pollTransactionReceipt } from "@/lib/starknet/transaction-confirmation";
import { ONBOARDING_MIN_STRK } from "@/lib/privacy/onboarding-limits";

import { useUsdcMaturity } from "./use-usdc-maturity";

export function UnshieldButton() {
  const { network, starknet } = useNetwork();
  const { session, balances, refreshBalances, signatureProgress } =
    useTreasury();
  const [amount, setAmount] = useState("");
  const [unshielding, setUnshielding] = useState(false);
  const privateUsdc = balances?.privateUsdc ?? BigInt(0);
  const publicStrk = balances?.strkWei ?? BigInt(0);
  const notes = useUsdcMaturity(session?.address, privateUsdc);
  /* Unshielding pays the pool fee and gas from public STRK on this rail,
     the same as shield and registration - Ready X's own paymaster covers it
     there instead, so this only ever gates the EVM rail. */
  const evmGasShort = session?.kind === "evm" && publicStrk < ONBOARDING_MIN_STRK;

  if (!session) return null;

  async function handleUnshield() {
    if (!session) return;
    setUnshielding(true);
    try {
      const parsed = amount.trim() ? parseUsdc(amount) : privateUsdc;
      if (parsed <= BigInt(0)) throw new Error("Enter an amount to unshield");
      if (parsed > privateUsdc) {
        throw new Error(
          `Only ${formatUsdc(privateUsdc)} private USDC is available`,
        );
      }

      const token = getShieldToken("usdc", network);
      const response = await payoutToken(
        session.account,
        token,
        parsed,
        session.address,
      );
      recordActivity({
        network,
        kind: "unshield",
        source: "morok",
        amount: formatUsdc(parsed),
        amountRaw: parsed.toString(),
        from: session.address,
        to: session.address,
        address: session.address,
        txHash: response.transaction_hash,
      });
      txToast({
        title: "Unshield submitted",
        txHash: response.transaction_hash,
        explorerUrl: `${starknet.explorer}/tx/${response.transaction_hash}`,
        explorerLabel: "Voyager",
      });
      setAmount("");
      await pollTransactionReceipt({
        read: () => session.account.provider.getTransactionReceipt(response.transaction_hash),
      });
      await refreshBalances();
    } catch (caught) {
      toast.error(formatStrk20Error(caught, "payout"));
    } finally {
      setUnshielding(false);
    }
  }

  /* Split from evmGasShort on purpose: "nothing to withdraw yet" and
     "notes still maturing" are reasons to grey out every control, but a
     short public-STRK balance is not - the reader needs to be able to type
     an amount before the warning below has anything to attach to. Only the
     submit button folds evmGasShort back in, since that is the one place a
     doomed on-chain call would actually be sent. */
  const controlsDisabled =
    unshielding || privateUsdc <= BigInt(0) || !notes.ready;
  const canUnshield = !controlsDisabled && !evmGasShort;
  const showGasWarning = evmGasShort && amount.trim().length > 0;

  return (
    <div className="flex w-full flex-col gap-2">
      {/* Both explanations moved into tooltips. They are worth reading once
          and re-reading never, and as standing paragraphs they pushed the
          controls off the card. The maturity line below stays visible, since
          it is the only one that says wait rather than explains. */}
      {showGasWarning ? (
        <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-2.5 py-2 ring-1 ring-foreground/10">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-muted-foreground">
            This account holds {formatStrk(publicStrk)} public STRK.
            Unshielding costs the pool fee plus gas here - about{" "}
            {formatStrk(ONBOARDING_MIN_STRK)} is the safe amount to hold
            before trying. Top up public STRK first.
          </p>
        </div>
      ) : null}
      {privateUsdc > BigInt(0) && !notes.ready ? (
        <p className="font-mono text-sm font-semibold tabular-nums">
          Matures in {notes.remainingLabel}
        </p>
      ) : null}
      {/* Own row for the field: five siblings (input + 50% + Max + dice +
          info) never fit beside it in the sidebar's narrow column no matter
          how much flex-1 claims - the buttons' combined minimum width alone
          exceeds it. Giving the input the full row and moving every button
          to a row underneath is the fix that holds at any width, not just
          the one in the screenshot this was reported from. */}
      <Input
        id="unshield-amount"
        inputMode="decimal"
        aria-label="USDC amount to unshield"
        placeholder={!controlsDisabled ? formatUsdc(privateUsdc) : "0.00"}
        value={amount}
        disabled={controlsDisabled}
        onChange={(event) => setAmount(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={controlsDisabled}
          onClick={() => setAmount(formatUsdc(privateUsdc / BigInt(2)))}
        >
          50%
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={controlsDisabled}
          onClick={() => setAmount(formatUsdc(privateUsdc))}
        >
          Max
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="shrink-0"
                aria-label="Pick an amount that matches nothing"
                disabled={controlsDisabled}
                onClick={() =>
                  setAmount(formatUsdc(jitterUnshieldAmount(privateUsdc)))
                }
              >
                <DicesIcon />
              </Button>
            }
          />
          <TooltipContent>
            Withdrawing a round number, or all of it, is what gives you away: a
            supporter who sent you $5 and then watches exactly $5 leave has
            learned nobody else sent anything. Roll for an odd amount and leave
            the rest behind.
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="shrink-0"
                aria-label="What becomes public when you withdraw"
              >
                <InfoIcon />
              </Button>
            }
          />
          <TooltipContent>
            Withdraw to this account. The amount, destination, and time become
            public. A new private note may need about 10 blocks before it can be
            spent.{" "}
            {session.kind === "ready"
              ? "Ready X covers the pool fee and gas itself and takes its own cut out of what you withdraw instead - about 15-18% in what we've measured, not from your public STRK."
              : "The pool fee (about 6 STRK) comes out of your public balance, not the amount withdrawn."}
          </TooltipContent>
        </Tooltip>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={unshielding || !canUnshield}
        aria-busy={unshielding}
        onClick={() => {
          void handleUnshield();
        }}
      >
        {unshielding ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <EyeOffIcon data-icon="inline-start" />
        )}
        {unshielding
          ? signatureProgress
            ? `Signature ${signatureProgress.step} of ${signatureProgress.total}`
            : "Unshielding"
          : "Unshield USDC"}
      </Button>
    </div>
  );
}
