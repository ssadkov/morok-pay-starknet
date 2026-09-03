"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldIcon } from "lucide-react";

import { txToast } from "@/components/pay/tx-toast";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseTokenAmount, parseUsdc } from "@/lib/amount";
import { recordActivity } from "@/lib/pay/activity";
import { ONBOARDING_MIN_STRK } from "@/lib/privacy/onboarding-limits";
import { shieldAsset, shieldToken } from "@/lib/starknet/actions";
import { STRK_ADDRESS } from "@/lib/starknet/constants";
import { formatStrk20Error } from "@/lib/starknet/errors";
import { formatStrk, formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";
import { pollTransactionReceipt } from "@/lib/starknet/transaction-confirmation";

import { usePoolFee } from "./use-pool-fee";
import { usePoolRegistration } from "./use-pool-registration";

export function ShieldButton({
  token,
}: {
  /** Lock the control to one asset. Onboarding uses this so the creator only sees STRK. */
  token?: "usdc" | "strk";
} = {}) {
  const { session, balances, refreshBalances, signatureProgress } =
    useTreasury();
  const { network, starknet } = useNetwork();
  const [amount, setAmount] = useState("");
  const [shielding, setShielding] = useState(false);
  const [shieldStrk, setShieldStrk] = useState(token === "strk");
  const usdc = getShieldToken("usdc", network);
  const publicUsdc = balances?.usdcRaw ?? BigInt(0);
  const publicStrk = balances?.strkWei ?? BigInt(0);
  // Sepolia charges 2 STRK, mainnet 6, so ask the pool instead of guessing.
  const poolFee = usePoolFee();
  const registration = usePoolRegistration(session?.address);
  // The deposit pays a fee of its own, so shielding the fee itself credits
  // nothing and the wallet rejects it.
  const defaultFeeShield = poolFee * BigInt(2);
  const needsFeeStrk = token ? token === "strk" : shieldStrk;
  /**
   * Gas for this call comes out of public STRK no matter which asset is being
   * shielded, and it is paid on top of whatever amount is entered - so a
   * balance just over the pool fee still fails on-chain the moment gas is
   * due. Ready X is not held to this: its shield/register calls have been
   * paymaster-sponsored in every mainnet run seen so far, so the account
   * itself owing nothing is the normal case there, not a balance to check.
   */
  const evmGasShort = session?.kind === "evm" && publicStrk < ONBOARDING_MIN_STRK;

  if (!session) return null;

  /* The pool cannot credit a note to an account with no viewing key
     registered, so shielding into one fails with an error the wallet cannot
     explain. Checked on both rails - an EVM account can now hold a session
     before it has activated, which is exactly when this matters. */
  if (registration !== "registered") {
    return (
      <p className="text-xs text-muted-foreground">
        {registration === "unknown"
          ? "Checking whether Private is enabled…"
          : session.kind === "evm"
            ? "Activate privacy for this account first - it needs a viewing key registered in the pool before it can hold anything private."
            : "Enable Private in Ready X first. Turn on Smart Account, then open Protected tokens, start Shield, and confirm the one-time activation."}
      </p>
    );
  }

  function fillMax() {
    setAmount(
      needsFeeStrk ? formatStrk(publicStrk) : formatUsdc(publicUsdc),
    );
  }

  function fillHalf() {
    setAmount(
      needsFeeStrk
        ? formatStrk(publicStrk / BigInt(2))
        : formatUsdc(publicUsdc / BigInt(2)),
    );
  }

  async function handleShield() {
    if (!session) return;
    setShielding(true);
    let txHash: string | undefined;
    try {
      if (needsFeeStrk) {
        const parsed = amount.trim()
          ? parseTokenAmount(amount, 18)
          : defaultFeeShield;
        if (parsed <= poolFee) {
          throw new Error(
            `The deposit costs ${formatStrk(poolFee)} STRK itself, so shield more than that`,
          );
        }
        if (parsed > publicStrk) {
          throw new Error(
            `Only ${formatStrk(publicStrk)} public STRK is available`,
          );
        }
        const response = await shieldAsset(
          session.account,
          STRK_ADDRESS,
          parsed,
        );
        txHash = response.transaction_hash;
        recordActivity({
          network,
          kind: "shield",
          source: "morok",
          amount: formatStrk(parsed),
          amountRaw: parsed.toString(),
          label: "STRK",
          from: session.address,
          to: session.address,
          address: session.address,
          txHash: response.transaction_hash,
        });
        txToast({
          title: "STRK shielded — private payments are on",
          txHash: response.transaction_hash,
          explorerUrl: `${starknet.explorer}/tx/${response.transaction_hash}`,
          explorerLabel: "Voyager",
        });
      } else {
        if (publicUsdc <= BigInt(0)) {
          throw new Error("No public USDC to shield");
        }
        const parsed = amount.trim() ? parseUsdc(amount) : publicUsdc;
        if (parsed <= BigInt(0)) {
          throw new Error("Enter an amount to shield");
        }
        if (parsed > publicUsdc) {
          throw new Error(
            `Only ${formatUsdc(publicUsdc)} public USDC is available`,
          );
        }
        const response = await shieldToken(session.account, usdc, parsed);
        txHash = response.transaction_hash;
        recordActivity({
          network,
          kind: "shield",
          source: "morok",
          amount: formatUsdc(parsed),
          amountRaw: parsed.toString(),
          from: session.address,
          to: session.address,
          address: session.address,
          txHash: response.transaction_hash,
        });
        txToast({
          title: "USDC shielded to payment wallet",
          txHash: response.transaction_hash,
          explorerUrl: `${starknet.explorer}/tx/${response.transaction_hash}`,
          explorerLabel: "Voyager",
        });
      }
      setAmount("");
      if (txHash) {
        await pollTransactionReceipt({
          read: () => session.account.provider.getTransactionReceipt(txHash!),
        });
      }
      await refreshBalances();
    } catch (caught) {
      toast.error(formatStrk20Error(caught, "shield"));
    } finally {
      setShielding(false);
    }
  }

  const canShield = evmGasShort
    ? false
    : needsFeeStrk
      ? publicStrk > poolFee
      : publicUsdc > BigInt(0);
  const placeholder = needsFeeStrk
    ? formatStrk(defaultFeeShield)
    : publicUsdc > BigInt(0)
      ? formatUsdc(publicUsdc)
      : "0.00";

  return (
    <div className="flex w-full flex-col gap-2">
      {evmGasShort ? (
        <p className="text-xs text-destructive">
          This account holds {formatStrk(publicStrk)} public STRK. Shielding
          costs the pool fee plus gas here - about {formatStrk(ONBOARDING_MIN_STRK)}{" "}
          is the safe amount to hold before trying, or the deposit can fail
          partway through. Top up public STRK first.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {needsFeeStrk
            ? `Shield more than ${formatStrk(poolFee)} STRK. The deposit pays that fee itself and registers this account in the pool.`
            : `Moves public USDC into the private wallet. The pool fee comes out of the amount, worth ${formatStrk(poolFee)} STRK.`}
        </p>
      )}
      {token ? null : (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => {
            setShieldStrk(!needsFeeStrk);
            setAmount("");
          }}
        >
          {needsFeeStrk ? "Shield USDC instead" : "Shield STRK for pool fees"}
        </button>
      )}
      <div className="flex gap-2">
        <Input
          id="shield-amount"
          inputMode="decimal"
          aria-label={needsFeeStrk ? "STRK amount to shield" : "USDC amount to shield"}
          placeholder={placeholder}
          value={amount}
          disabled={shielding || !canShield}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={shielding || !canShield}
          onClick={fillHalf}
        >
          50%
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={shielding || !canShield}
          onClick={fillMax}
        >
          Max
        </Button>
      </div>
      <Button
        type="button"
        size={token ? "lg" : "sm"}
        className={token ? "min-h-12" : undefined}
        disabled={shielding || !canShield}
        aria-busy={shielding}
        onClick={() => {
          void handleShield();
        }}
      >
        {shielding ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <ShieldIcon data-icon="inline-start" />
        )}
        {shielding
          ? signatureProgress
            ? `Signature ${signatureProgress.step} of ${signatureProgress.total}`
            : "Shielding"
          : needsFeeStrk
            ? "Shield STRK for fees"
            : "Shield USDC"}
      </Button>
    </div>
  );
}
