"use client";

import Link from "next/link";
import { BlocksIcon } from "lucide-react";

import { ConnectReady } from "@/components/pay/connect-ready";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { shortenAddress } from "@/lib/format";

/**
 * The three screens that need a full session - park, publish a QR, donate -
 * all render this while they have none, and a missing session is not the same
 * thing as a missing wallet.
 *
 * `sponsored` used to soften the mainnet "funded by you" line for /claim,
 * which now says its own piece; the claim path deliberately needs no session
 * at all, so this component no longer appears there.
 */
export function ConnectWalletChoices() {
  const { network } = useNetwork();
  const { connecting, evmConnecting, connectEvm, evmConnectedAddress } =
    useTreasury();

  /* Offering to connect a wallet that is already connected reads as the app
     not noticing - the header names the very address it is asking for. What
     is actually missing here is the Starknet account behind it, and asking
     again cannot produce one. */
  if (evmConnectedAddress) {
    return (
      <Alert>
        <AlertTitle>Finish setting up this wallet</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <p>
            {shortenAddress(evmConnectedAddress)} is connected, but its Starknet
            account is not ready yet, so it cannot hold private USDC. Four
            steps, and each one says who pays for it.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            nativeButton={false}
            render={<Link href="/start" />}
          >
            Go to Start
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    /* EVM first and primary. Ready X used to hold both positions, which told
       every visitor the opposite of the pitch before they read the sentence
       underneath saying no Starknet wallet is needed. */
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          size="lg"
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
          {network === "mainnet" ? ", funded by you on mainnet." : "."}
        </p>
      </div>
      <ConnectReady />
    </div>
  );
}
