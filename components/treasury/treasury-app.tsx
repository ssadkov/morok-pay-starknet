"use client";

import { TestnetHint } from "@/components/pay/testnet-hint";
import { ConnectPanel } from "@/components/treasury/connect-panel";
import { FlowSteps } from "@/components/treasury/flow-steps";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Skeleton } from "@/components/ui/skeleton";
import { useSyncExternalStore } from "react";

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function currentStep(connected: boolean, publicUsdc: bigint, privateUsdc: bigint) {
  if (!connected) return 1;
  if (publicUsdc === BigInt(0) && privateUsdc === BigInt(0)) return 2;
  if (privateUsdc === BigInt(0)) return 3;
  return 4;
}

export function TreasuryApp() {
  const { session, balances } = useTreasury();
  const { network } = useNetwork();
  const isClient = useIsClient();
  const connected = Boolean(session);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Top up</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {network === "sepolia"
            ? "Testnet: mint USDC to this Ready X from the Circle faucet (Starknet Sepolia), or bridge from Base Sepolia, then shield. Pool fee is 2 STRK."
            : "Fund Ready X from Base, shield into the STRK20 pool, then pay privately or cash out to Base."}
        </p>
      </div>
      <TestnetHint />
      {!isClient ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <>
          {!connected ? <ConnectPanel /> : null}
        </>
      )}
      <section className="flex flex-col gap-4" aria-labelledby="flow-heading">
        <h2 id="flow-heading" className="text-xl font-semibold">
          Funding flow
        </h2>
        <FlowSteps
          currentStep={currentStep(
            connected,
            balances?.usdcRaw ?? BigInt(0),
            balances?.privateUsdc ?? BigInt(0),
          )}
        />
      </section>
    </div>
  );
}
