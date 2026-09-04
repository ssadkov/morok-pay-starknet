import { Suspense } from "react";

import { AppShell } from "@/components/pay/app-shell";
import { StartPanel } from "@/components/pay/start-panel";
import { Skeleton } from "@/components/ui/skeleton";

export default function StartPage() {
  return (
    <AppShell>
      {/* The panel reads `?claim=` to sponsor a claimer's account, and
          useSearchParams opts a statically prerendered page out of the build
          unless it sits behind a boundary - same reason /claim has one. */}
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <StartPanel />
      </Suspense>
    </AppShell>
  );
}
