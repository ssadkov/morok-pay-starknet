"use client";

import { Suspense } from "react";

import { AppShell } from "@/components/pay/app-shell";
import { PayPanel } from "@/components/pay/pay-panel";
import { Skeleton } from "@/components/ui/skeleton";

export default function PayPage() {
  return (
    <AppShell>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <PayPanel />
      </Suspense>
    </AppShell>
  );
}
