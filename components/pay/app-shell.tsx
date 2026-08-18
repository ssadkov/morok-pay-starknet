"use client";

import type { ReactNode } from "react";

import { BalanceSidebar } from "@/components/pay/balance-sidebar";
import { AppHeader } from "@/components/treasury/app-header";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-8 px-4 py-8 md:px-6 md:py-12 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <main className="flex min-w-0 flex-col gap-8">{children}</main>
        <div className="order-first lg:order-last">
          <BalanceSidebar />
        </div>
      </div>
    </div>
  );
}
