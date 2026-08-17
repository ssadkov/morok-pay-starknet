"use client";

import { WalletIcon } from "lucide-react";

import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { READY_WALLET_URL } from "@/lib/starknet/constants";

export function ConnectPanel() {
  const { wallets, connecting, connectError, connectWallet } = useTreasury();

  return (
    <Empty className="border border-dashed border-border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WalletIcon />
        </EmptyMedia>
        <EmptyTitle>Connect Ready</EmptyTitle>
        <EmptyDescription>
          Ready holds the STRK20 viewing key and talks to the official proving
          service. Shield and payout both go through the Wallet API.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {wallets.length ? (
          wallets.map((wallet) => (
            <Button
              key={wallet.name}
              type="button"
              size="lg"
              className="min-h-10 min-w-40"
              disabled={connecting}
              aria-busy={connecting}
              onClick={() => {
                void connectWallet(wallet);
              }}
            >
              {connecting ? <Spinner data-icon="inline-start" /> : null}
              {connecting ? "Connecting" : `Connect ${wallet.name}`}
            </Button>
          ))
        ) : (
          <Button
            type="button"
            size="lg"
            className="min-h-10 min-w-40"
            render={
              <a href={READY_WALLET_URL} target="_blank" rel="noreferrer" />
            }
          >
            Install Ready
          </Button>
        )}
        {!wallets.length ? (
          <p className="text-sm text-muted-foreground">
            No Starknet wallet found. Install Ready, then refresh this page.
          </p>
        ) : null}
        {connectError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not connect</AlertTitle>
            <AlertDescription>{connectError}</AlertDescription>
          </Alert>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}
