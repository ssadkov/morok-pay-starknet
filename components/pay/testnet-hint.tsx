"use client";

import { toast } from "sonner";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  CIRCLE_FAUCET_URL,
  STARKNET_SEPOLIA_STRK_FAUCET_URL,
} from "@/lib/pay/testnet";

export function TestnetHint() {
  const { network } = useNetwork();
  const { session } = useTreasury();

  if (network !== "sepolia") return null;

  // An EVM session never has a Ready account: its Starknet address is derived
  // from the EVM key, so calling it "Ready" points at the wrong wallet.
  const isEvm = session?.kind === "evm";
  const addressLabel = isEvm ? "derived Starknet address" : "Ready address";

  async function copyAddress() {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.address);
      toast.success(
        isEvm ? "Derived Starknet address copied" : "Ready address copied",
      );
    } catch {
      toast.error("Could not copy address");
    }
  }

  return (
    <Alert>
      <AlertTitle>Sepolia testnet</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          Dry-run the QR loop here. Point your wallet at Starknet Sepolia. Pool
          fee is 2 STRK. Sprint evidence still has to be mainnet.
        </p>
        <p>
          {isEvm
            ? "Fast path: get test STRK to the derived address below, then shield more than 2 STRK for the pool fee. Circle USDC is only needed when testing fixed-amount payments."
            : "Fast path: get test STRK, make one outgoing Ready transaction to deploy the account, then shield more than 2 STRK for the pool fee. Circle USDC is only needed when testing fixed-amount payments."}
        </p>
        <div className="flex flex-wrap gap-2">
          {session ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void copyAddress()}>
              Copy {addressLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={STARKNET_SEPOLIA_STRK_FAUCET_URL}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            Get test STRK
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a href={CIRCLE_FAUCET_URL} target="_blank" rel="noreferrer" />
            }
          >
            Get test USDC
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
