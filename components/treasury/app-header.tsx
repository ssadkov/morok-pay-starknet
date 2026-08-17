"use client";

import { WalletIcon } from "lucide-react";

import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { shortenAddress } from "@/lib/format";

export function AppHeader() {
  const { session, wallets, connecting, connectWallet, disconnect } =
    useTreasury();
  const wallet = wallets[0];

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex min-h-14 max-w-3xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <div className="flex min-w-0 flex-col">
          <p className="text-sm font-medium tracking-tight">MorokPay</p>
          <p className="text-xs text-muted-foreground">Private treasury</p>
        </div>
        {session ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-10"
            onClick={disconnect}
          >
            {shortenAddress(session.address)}
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            className="min-h-10"
            disabled={!wallet || connecting}
            aria-busy={connecting}
            onClick={() => {
              if (wallet) void connectWallet(wallet);
            }}
          >
            {connecting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <WalletIcon data-icon="inline-start" />
            )}
            {connecting ? "Connecting" : "Connect Ready"}
          </Button>
        )}
      </div>
    </header>
  );
}
