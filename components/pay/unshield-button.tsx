"use client";

import { useState } from "react";
import { DicesIcon, EyeOffIcon, InfoIcon } from "lucide-react";
import { toast } from "sonner";

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
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";
import { pollTransactionReceipt } from "@/lib/starknet/transaction-confirmation";

import { useUsdcMaturity } from "./use-usdc-maturity";

export function UnshieldButton() {
  const { network, starknet } = useNetwork();
  const { session, balances, refreshBalances, signatureProgress } =
    useTreasury();
  const [amount, setAmount] = useState("");
  const [unshielding, setUnshielding] = useState(false);
  const privateUsdc = balances?.privateUsdc ?? BigInt(0);
  const notes = useUsdcMaturity(session?.address, privateUsdc);

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
      toast.success("Unshield submitted", {
        description: response.transaction_hash,
        action: {
          label: "Voyager",
          onClick: () =>
            window.open(
              `${starknet.explorer}/tx/${response.transaction_hash}`,
              "_blank",
              "noopener,noreferrer",
            ),
        },
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

  const canUnshield = privateUsdc > BigInt(0) && notes.ready;

  return (
    <div className="flex w-full flex-col gap-2">
      {/* Both explanations moved into tooltips. They are worth reading once
          and re-reading never, and as standing paragraphs they pushed the
          controls off the card. The maturity line below stays visible, since
          it is the only one that says wait rather than explains. */}
      {privateUsdc > BigInt(0) && !notes.ready ? (
        <p className="font-mono text-sm font-semibold tabular-nums">
          Matures in {notes.remainingLabel}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Input
          id="unshield-amount"
          inputMode="decimal"
          aria-label="USDC amount to unshield"
          placeholder={canUnshield ? formatUsdc(privateUsdc) : "0.00"}
          value={amount}
          disabled={unshielding || !canUnshield}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={unshielding || !canUnshield}
          onClick={() => setAmount(formatUsdc(privateUsdc / BigInt(2)))}
        >
          50%
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={unshielding || !canUnshield}
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
                aria-label="Pick an amount that matches nothing"
                disabled={unshielding || !canUnshield}
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
