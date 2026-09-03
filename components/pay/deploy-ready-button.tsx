"use client";

import { useState } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import { toast } from "sonner";

import { txToast } from "@/components/pay/tx-toast";
import { validateAndParseAddress } from "starknet";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { transferPublicStrk } from "@/lib/starknet/actions";
import { describeError } from "@/lib/starknet/errors";

const ACTIVATION_TIP = BigInt(10) ** BigInt(16); // 0.01 STRK

function treasuryAddress(value: string) {
  if (!value) return null;
  try {
    return validateAndParseAddress(value);
  } catch {
    return null;
  }
}

export function DeployReadyButton() {
  const { session, balances, refreshBalances } = useTreasury();
  const { starknet } = useNetwork();
  const [submitting, setSubmitting] = useState(false);
  const treasury = treasuryAddress(starknet.treasury);

  if (!session || session.kind !== "ready" || !treasury) return null;
  const publicStrk = balances?.strkWei ?? BigInt(0);

  async function deploy() {
    if (!session || session.kind !== "ready" || !treasury) return;
    setSubmitting(true);
    try {
      const response = await transferPublicStrk(
        session.account,
        treasury,
        ACTIVATION_TIP,
      );
      txToast({
        title: "Ready X activation submitted",
        note: "0.01 public STRK sent to MorokPay treasury",
        txHash: response.transaction_hash,
        explorerUrl: `${starknet.explorer}/tx/${response.transaction_hash}`,
        explorerLabel: "Voyager",
      });
      await refreshBalances({ private: false });
    } catch (error) {
      toast.error(describeError(error) || "Ready X activation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="lg"
        className="min-h-12"
        disabled={submitting || publicStrk <= ACTIVATION_TIP}
        aria-busy={submitting}
        onClick={() => {
          void deploy();
        }}
      >
        {submitting ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <ArrowUpRightIcon data-icon="inline-start" />
        )}
        {submitting ? "Sending…" : "Send 0.01 STRK to MorokPay"}
      </Button>
      <p className="text-xs text-muted-foreground">
        A public transfer, not a fee - Ready X deploys itself as a side effect
        of sending anywhere, and this address is just a convenient one. Ready
        X will offer to activate the account itself, for free, when you open
        Protected tokens; use that instead if you would rather not send this.
        Either way this does not enable Private by itself.
      </p>
    </div>
  );
}
