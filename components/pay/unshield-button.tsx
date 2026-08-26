"use client";

import Link from "next/link";
import { useState } from "react";
import { EyeOffIcon } from "lucide-react";
import { toast } from "sonner";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseUsdc } from "@/lib/amount";
import { recordActivity } from "@/lib/pay/activity";
import { payoutToken } from "@/lib/starknet/actions";
import { formatStrk20Error } from "@/lib/starknet/errors";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

export function UnshieldButton() {
  const { network, starknet } = useNetwork();
  const { session, balances, refreshBalances } = useTreasury();
  const [amount, setAmount] = useState("");
  const [unshielding, setUnshielding] = useState(false);
  const privateUsdc = balances?.privateUsdc ?? BigInt(0);

  if (!session) return null;

  if (session.kind === "evm") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          EVM unshield remains in the Sepolia lab so its public recipient, pool
          fee, and proof can be reviewed before signing.
        </p>
        <Button
          nativeButton={false}
          variant="outline"
          render={<Link href="/privacy-sdk-lab" />}
        >
          Open EVM Lab
        </Button>
      </div>
    );
  }

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
      await refreshBalances();
    } catch (caught) {
      toast.error(formatStrk20Error(caught, "payout"));
    } finally {
      setUnshielding(false);
    }
  }

  const canUnshield = privateUsdc > BigInt(0);

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Withdraw to this Ready account. The amount, destination, and time become
        public. A new private note may need about 10 blocks before it can be
        spent.
      </p>
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
          onClick={() => setAmount(formatUsdc(privateUsdc))}
        >
          Max
        </Button>
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
        {unshielding ? "Unshielding" : "Unshield USDC"}
      </Button>
    </div>
  );
}
