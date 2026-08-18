"use client";

import { toast } from "sonner";

import { ShieldButton } from "@/components/pay/shield-button";
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

  async function copyReady() {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.address);
      toast.success("Ready address copied");
    } catch {
      toast.error("Could not copy address");
    }
  }

  return (
    <Alert>
      <AlertTitle>Sepolia testnet</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          Dry-run the QR loop here. Switch Ready to Starknet Sepolia. Pool fee
          is 2 STRK. Sprint evidence still has to be mainnet.
        </p>
        <p>
          Fast path: test STRK for the fee, Circle USDC on Starknet Sepolia
          into the public Wallet, then Shield — that moves it into the
          payment wallet. Pool fee is 2 STRK.
        </p>
        <div className="flex flex-wrap gap-2">
          {session ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void copyReady()}>
              Copy Ready address
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
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
            render={
              <a href={CIRCLE_FAUCET_URL} target="_blank" rel="noreferrer" />
            }
          >
            Get test USDC
          </Button>
        </div>
        <ShieldButton />
      </AlertDescription>
    </Alert>
  );
}
