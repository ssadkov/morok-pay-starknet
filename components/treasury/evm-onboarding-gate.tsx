"use client";

import Link from "next/link";
import { ExternalLinkIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTreasury } from "@/components/treasury/treasury-context";

export function EvmOnboardingGate() {
  const { evmGate, dismissEvmGate } = useTreasury();
  if (!evmGate) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evm-onboarding-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              Sepolia EVM wallet
            </p>
            <h2 id="evm-onboarding-title" className="text-xl font-semibold">
              Finish private-account onboarding
            </h2>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Close onboarding message"
            onClick={dismissEvmGate}
          >
            <XIcon />
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{evmGate.message}</p>
        {evmGate.address ? (
          <div className="mt-4 rounded-xl bg-muted/50 p-3 ring-1 ring-foreground/10">
            <p className="text-xs text-muted-foreground">
              Deterministic Starknet account
            </p>
            <p className="mt-1 break-all font-mono text-xs tabular-nums">
              {evmGate.address}
            </p>
          </div>
        ) : null}
        <p className="mt-4 text-sm text-muted-foreground">
          The EVM Lab checks deployment, the compatible account class, and
          STRK20 registration. Return here and connect again when every step is
          confirmed.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={dismissEvmGate}>
            Not now
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/privacy-sdk-lab" />}
            onClick={dismissEvmGate}
          >
            Open EVM Lab
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  );
}
