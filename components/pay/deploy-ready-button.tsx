"use client";

import { useState } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import { toast } from "sonner";
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
      toast.success("Ready X activation submitted", {
        description: "0.01 public STRK sent to MorokPay treasury",
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
        {submitting ? "Activating Ready X" : "Activate for 0.01 STRK"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Public transaction: deploys this Ready X account and sends 0.01 STRK to
        the MorokPay treasury. This does not enable Private by itself.
      </p>
    </div>
  );
}
