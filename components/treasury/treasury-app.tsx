"use client";

import { useSyncExternalStore } from "react";

import { AccountCard } from "@/components/treasury/account-card";
import { AppHeader } from "@/components/treasury/app-header";
import { ConnectPanel } from "@/components/treasury/connect-panel";
import { FlowSteps } from "@/components/treasury/flow-steps";
import {
  TreasuryProvider,
  useTreasury,
} from "@/components/treasury/treasury-context";
import { Skeleton } from "@/components/ui/skeleton";

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

function TreasuryBody() {
  const { session, balances } = useTreasury();
  const isClient = useIsClient();
  const connected = Boolean(session);

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 md:px-6 md:py-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Private USDC treasury
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Fund Ready from Ethereum, shield USDC into the official STRK20
            pool, then pay out to a fresh Starknet address.
          </p>
        </div>
        {!isClient ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : (
          <>
            {!connected ? <ConnectPanel /> : null}
            {connected ? <AccountCard /> : null}
          </>
        )}
        <section className="flex flex-col gap-4" aria-labelledby="flow-heading">
          <h2 id="flow-heading" className="text-xl font-semibold">
            Treasury flow
          </h2>
          <FlowSteps
            currentStep={currentStep(
              connected,
              balances?.usdcRaw ?? BigInt(0),
              balances?.privateUsdc ?? BigInt(0),
            )}
          />
        </section>
      </main>
    </div>
  );
}

export function TreasuryApp() {
  return (
    <TreasuryProvider>
      <TreasuryBody />
    </TreasuryProvider>
  );
}
