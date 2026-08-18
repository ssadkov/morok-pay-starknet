"use client";

import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const STEPS = [
  {
    id: 1,
    title: "Connect Ready",
    body: "Ready is the official STRK20 wallet. It holds the viewing key and talks to the proving service.",
  },
  {
    id: 2,
    title: "Fund USDC from Base",
    body: "Burn USDC on Base with MetaMask. Circle mints native USDC to this Ready address on Starknet.",
  },
  {
    id: 3,
    title: "Shield into STRK20",
    body: "Deposit public USDC or strkBTC into the shared pool. The amount is public; the remaining notes stay private.",
  },
  {
    id: 4,
    title: "Pay or cash out",
    body: "Pay a merchant QR from the private balance, or cash out to a Base address.",
  },
] as const;

export function FlowSteps({ currentStep }: { currentStep: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="flex flex-col gap-3">
      {STEPS.map((step) => {
        const done = step.id < currentStep;
        const active = step.id === currentStep;
        return (
          <li
            key={step.id}
            className={cn(
              "flex gap-3 rounded-lg border border-border p-4",
              active ? "bg-card" : "bg-muted/40",
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                done || active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
              aria-hidden
            >
              {done ? <CheckIcon /> : step.id}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-sm text-muted-foreground">{step.body}</p>
              {step.id > currentStep ? (
                <p className="text-xs text-muted-foreground">Next</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
