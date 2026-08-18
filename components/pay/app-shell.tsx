"use client";

import type { ReactNode } from "react";

import { AppHeader } from "@/components/treasury/app-header";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 md:px-6 md:py-12">
        {children}
      </main>
    </div>
  );
}
