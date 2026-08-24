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
import { MOROK_TREASURY_ADDRESS } from "@/lib/starknet/constants";
import { describeError } from "@/lib/starknet/errors";

const ACTIVATION_TIP = BigInt(10) ** BigInt(16); // 0.01 STRK

function treasuryAddress() {
  if (!MOROK_TREASURY_ADDRESS) return null;
  try {
    return validateAndParseAddress(MOROK_TREASURY_ADDRESS);
  } catch {
    return null;
  }
}

export function DeployReadyButton() {
  const { session, balances, refreshBalances } = useTreasury();
  const { starknet } = useNetwork();
  const [submitting, setSubmitting] = useState(false);
  const treasury = treasuryAddress();

  if (!session || !treasury) return null;
  const publicStrk = balances?.strkWei ?? BigInt(0);

  async function deploy() {
    if (!session || !treasury) return;
    setSubmitting(true);
    try {
      const response = await transferPublicStrk(
        session.account,
        treasury,
        ACTIVATION_TIP,
      );
      toast.success("Ready activation submitted", {
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
      toast.error(describeError(error) || "Ready activation failed");
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
        {submitting ? "Activating Ready" : "Activate for 0.01 STRK"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Public transaction: deploys this Ready account and sends 0.01 STRK to
        the MorokPay treasury. This does not enable Private by itself.
      </p>
    </div>
  );
}
