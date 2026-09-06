"use client";

import { WalletIcon } from "lucide-react";

import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { READY_WALLET_URL } from "@/lib/starknet/constants";

/**
 * Secondary everywhere it appears beside the EVM choice. The pitch is that a
 * Starknet wallet is optional, so the Starknet wallet cannot be the button
 * wearing the primary colour.
 */
export function ConnectReady({ variant = "outline" }: { variant?: "default" | "outline" }) {
  const { wallets, connecting, connectError, connectWallet } = useTreasury();

  return (
    <div className="flex flex-col gap-3">
      {wallets.length ? (
        wallets.map((wallet) => (
          <Button
            key={wallet.name}
            type="button"
            size="lg"
            variant={variant}
            className="min-h-12 w-full sm:w-auto"
            disabled={connecting}
            aria-busy={connecting}
            onClick={() => {
              void connectWallet(wallet);
            }}
          >
            {connecting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <WalletIcon data-icon="inline-start" />
            )}
            {connecting ? "Connecting" : `Connect ${wallet.name}`}
          </Button>
        ))
      ) : (
        <Button
          type="button"
          size="lg"
          variant={variant}
          className="min-h-12 w-full sm:w-auto"
          nativeButton={false}
          render={
            <a href={READY_WALLET_URL} target="_blank" rel="noreferrer" />
          }
        >
          Install Ready X
        </Button>
      )}
      {!wallets.length ? (
        <p className="text-sm text-muted-foreground">
          Install the extension, then refresh this page. Braavos cannot shield.
        </p>
      ) : null}
      {connectError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not connect</AlertTitle>
          <AlertDescription>{connectError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
