"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldIcon } from "lucide-react";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { recordActivity } from "@/lib/pay/activity";
import { shieldToken } from "@/lib/starknet/actions";
import { formatStrk20Error } from "@/lib/starknet/errors";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

export function ShieldButton({
  size = "sm",
  variant = "default",
}: {
  size?: "sm" | "lg";
  variant?: "default" | "outline";
}) {
  const { session, balances, refreshBalances } = useTreasury();
  const { network, starknet } = useNetwork();
  const [shielding, setShielding] = useState(false);
  const usdc = getShieldToken("usdc", network);
  const publicUsdc = balances?.usdcRaw ?? BigInt(0);

  if (!session) return null;

  async function handleShield() {
    if (!session || publicUsdc <= BigInt(0)) return;
    setShielding(true);
    try {
      const response = await shieldToken(session.account, usdc, publicUsdc);
      recordActivity({
        network,
        kind: "shield",
        source: "morok",
        amount: formatUsdc(publicUsdc),
        amountRaw: publicUsdc.toString(),
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
      await refreshBalances();
    } catch (caught) {
      toast.error(formatStrk20Error(caught, "shield"));
    } finally {
      setShielding(false);
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
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
      {shielding
        ? "Shielding"
        : publicUsdc > BigInt(0)
          ? `Shield ${formatUsdc(publicUsdc)} USDC`
          : "Shield to payment wallet"}
    </Button>
  );
}
