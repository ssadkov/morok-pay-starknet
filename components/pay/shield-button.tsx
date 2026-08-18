"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldIcon } from "lucide-react";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseUsdc } from "@/lib/amount";
import { recordActivity } from "@/lib/pay/activity";
import { shieldToken } from "@/lib/starknet/actions";
import { formatStrk20Error } from "@/lib/starknet/errors";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

export function ShieldButton() {
  const { session, balances, refreshBalances } = useTreasury();
  const { network, starknet } = useNetwork();
  const [amount, setAmount] = useState("");
  const [shielding, setShielding] = useState(false);
  const usdc = getShieldToken("usdc", network);
  const publicUsdc = balances?.usdcRaw ?? BigInt(0);
  const strkWei = balances?.strkWei ?? BigInt(0);

  if (!session) return null;

  function fillMax() {
    setAmount(formatUsdc(publicUsdc));
  }

  async function handleShield() {
    if (!session || publicUsdc <= BigInt(0)) return;
    setShielding(true);
    try {
      const parsed = amount.trim() ? parseUsdc(amount) : publicUsdc;
      if (parsed <= BigInt(0)) {
        throw new Error("Enter an amount to shield");
      }
      if (parsed > publicUsdc) {
        throw new Error(
          `Only ${formatUsdc(publicUsdc)} public USDC is available`,
        );
      }
      if (strkWei === BigInt(0)) {
        throw new Error(
          "Need 2 STRK for the pool fee. Get test STRK first, then shield.",
        );
      }
      const response = await shieldToken(session.account, usdc, parsed);
      recordActivity({
        network,
        kind: "shield",
        source: "morok",
        amount: formatUsdc(parsed),
        amountRaw: parsed.toString(),
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
      setAmount("");
      await refreshBalances();
    } catch (caught) {
      toast.error(formatStrk20Error(caught, "shield"));
    } finally {
      setShielding(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex gap-2">
        <Input
          id="shield-usdc-amount"
          inputMode="decimal"
          aria-label="USDC amount to shield"
          placeholder={
            publicUsdc > BigInt(0) ? formatUsdc(publicUsdc) : "0.00"
          }
          value={amount}
          disabled={shielding || publicUsdc <= BigInt(0)}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={shielding || publicUsdc <= BigInt(0)}
          onClick={fillMax}
        >
          Max
        </Button>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={shielding || publicUsdc <= BigInt(0)}
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
        {shielding ? "Shielding" : "Shield to payment wallet"}
      </Button>
    </div>
  );
}
