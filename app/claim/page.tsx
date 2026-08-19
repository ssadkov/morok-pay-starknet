"use client";

import { Suspense } from "react";

import { AppShell } from "@/components/pay/app-shell";
import { ClaimPanel } from "@/components/pay/claim-panel";
import { Skeleton } from "@/components/ui/skeleton";

export default function ClaimPage() {
  return (
    <AppShell>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <ClaimPanel />
      </Suspense>
    </AppShell>
  );
}
