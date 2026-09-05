"use client";

import { BlocksIcon } from "lucide-react";

import { ConnectReady } from "@/components/pay/connect-ready";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * `sponsored` is for the one screen where the claim pays: on /claim the
 * account is created on MorokPay, so the mainnet "funded by you" line would
 * contradict the button right below it.
 */
export function ConnectWalletChoices({ sponsored = false }: { sponsored?: boolean }) {
  const { network } = useNetwork();
  const { connecting, evmConnecting, connectEvm } = useTreasury();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ConnectReady />
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="min-h-12 w-full"
          disabled={connecting || evmConnecting}
          aria-busy={evmConnecting}
          onClick={() => void connectEvm()}
        >
          {evmConnecting ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <BlocksIcon data-icon="inline-start" />
          )}
          {evmConnecting ? "Checking account" : "Connect EVM wallet"}
        </Button>
        <p className="text-sm text-muted-foreground">
          MetaMask or another injected EVM wallet - no Starknet wallet needed.
          MorokPay derives a Starknet account from your address and walks you
          through creating it
          {sponsored
            ? ", and pays for it."
            : network === "mainnet"
              ? ", funded by you on mainnet."
              : "."}
        </p>
      </div>
    </div>
  );
}
