"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldIcon } from "lucide-react";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseTokenAmount, parseUsdc } from "@/lib/amount";
import { recordActivity } from "@/lib/pay/activity";
import { shieldAsset, shieldToken } from "@/lib/starknet/actions";
import { STRK_ADDRESS } from "@/lib/starknet/constants";
import { formatStrk20Error } from "@/lib/starknet/errors";
import { formatStrk, formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

import { usePoolFee } from "./use-pool-fee";
import { usePoolRegistration } from "./use-pool-registration";

export function ShieldButton({
  token,
}: {
  /** Lock the control to one asset. Onboarding uses this so the creator only sees STRK. */
  token?: "usdc" | "strk";
} = {}) {
  const { session, balances, refreshBalances } = useTreasury();
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

  if (!session) return null;

  if (registration !== "registered") {
    return (
      <p className="text-xs text-muted-foreground">
        {registration === "unknown"
          ? "Checking whether Private is enabled in Ready…"
          : "Enable Private in Ready first. Use Standard Account mode (turn off Smart Account), then open Protected tokens, start Shield, and confirm the one-time activation."}
      </p>
    );
  }

  function fillMax() {
    setAmount(
      needsFeeStrk ? formatStrk(publicStrk) : formatUsdc(publicUsdc),
    );
  }

  async function handleShield() {
    if (!session) return;
    setShielding(true);
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
        toast.success("STRK shielded — private payments are on", {
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
        toast.success("USDC shielded to payment wallet", {
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
      }
      setAmount("");
      await refreshBalances();
    } catch (caught) {
      toast.error(formatStrk20Error(caught, "shield"));
    } finally {
      setShielding(false);
    }
  }

  const canShield = needsFeeStrk
    ? publicStrk > poolFee
    : publicUsdc > BigInt(0);
  const placeholder = needsFeeStrk
    ? formatStrk(defaultFeeShield)
    : publicUsdc > BigInt(0)
      ? formatUsdc(publicUsdc)
      : "0.00";

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {needsFeeStrk
          ? `Shield more than ${formatStrk(poolFee)} STRK. The deposit pays that fee itself, then Ready registers this account in the pool.`
          : `Moves public USDC into the private wallet. The pool fee comes out of the amount, worth ${formatStrk(poolFee)} STRK.`}
      </p>
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
          ? "Shielding"
          : needsFeeStrk
            ? "Shield STRK for fees"
            : "Shield USDC"}
      </Button>
    </div>
  );
}
