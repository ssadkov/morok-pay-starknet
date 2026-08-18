"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  RefreshCwIcon,
  WalletIcon,
} from "lucide-react";

import { ShieldButton } from "@/components/pay/shield-button";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  readActivity,
  subscribeActivity,
  type ActivityItem,
} from "@/lib/pay/activity";
import { formatStrk, formatUsdc } from "@/lib/starknet/status";

const EMPTY_ACTIVITY: ActivityItem[] = [];

function useActivity(
  network: ReturnType<typeof useNetwork>["network"],
  address?: string,
) {
  return useSyncExternalStore(
    subscribeActivity,
    () => readActivity(network, address),
    () => EMPTY_ACTIVITY,
  );
}

function activityCopy(item: ActivityItem) {
  const morok = item.source !== "private";
  switch (item.kind) {
    case "pay":
      return {
        title: morok ? "Purchase" : "Private out",
        icon: ArrowUpRightIcon,
        sign: "−" as const,
      };
    case "receive":
      return {
        title: morok ? "Sale" : "Private in",
        icon: ArrowDownLeftIcon,
        sign: "+" as const,
      };
    case "shield":
      return {
        title: "Shield",
        icon: ArrowDownLeftIcon,
        sign: "+" as const,
      };
    case "unshield":
      return {
        title: "Cash out",
        icon: ArrowUpRightIcon,
        sign: "−" as const,
      };
  }
}

export function BalanceSidebar() {
  const { network } = useNetwork();
  const { session, balances, balancesLoading, refreshBalances } = useTreasury();
  const items = useActivity(network, session?.address);
  const loading = balancesLoading && !balances;
  const publicUsdc = balances?.usdcRaw ?? BigInt(0);
  const publicStrk = balances?.strkWei ?? BigInt(0);
  const privateUsdc = balances?.privateUsdc ?? BigInt(0);

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>Balances</CardTitle>
              <CardDescription>
                Public Ready wallet and private payment wallet.
              </CardDescription>
            </div>
            {session ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Refresh balances"
                onClick={() => {
                  void refreshBalances();
                }}
              >
                <RefreshCwIcon />
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!session ? (
            <p className="text-sm text-muted-foreground">
              Connect Ready in the header to see how much is in the wallet and
              the payment wallet.
            </p>
          ) : (
            <>
              <BalanceRow
                label="Wallet"
                hint="Public Ready account"
                loading={loading}
                amount={`${formatUsdc(publicUsdc)} USDC`}
                extra={`${formatStrk(publicStrk)} public STRK · ${formatStrk(balances?.privateStrk ?? BigInt(0))} shielded for pool fees`}
                action={<ShieldButton />}
              />
              <BalanceRow
                label="Payment wallet"
                hint="Private STRK20 pool"
                loading={loading}
                amount={`${formatUsdc(privateUsdc)} USDC`}
                extra={
                  balances?.privateError
                    ? balances.privateError
                    : "In-pool only — Ready holds the viewing key"
                }
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Private balance changes on this device. Morok payments and invoices
            are marked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!session ? (
            <p className="text-sm text-muted-foreground">
              Purchases, sales, and top-ups show up here after you connect.
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No private movement yet. Ready keeps the full history; this list
              is what this browser can see.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.slice(0, 10).map((item) => {
                const copy = activityCopy(item);
                const Icon = copy.icon;
                return (
                  <li
                    key={item.id}
                    className="rounded-xl bg-muted/40 px-3 py-2.5 ring-1 ring-foreground/10"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{copy.title}</p>
                          {item.label || item.invoice ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {[item.invoice, item.label]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <p className="shrink-0 text-sm tabular-nums">
                        {copy.sign}
                        {item.amount} USDC
                      </p>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      {item.source !== "private" ? (
                        <Badge>Morok</Badge>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          Private pool
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(item.at).toLocaleString()}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}

function BalanceRow({
  label,
  hint,
  amount,
  extra,
  loading,
  action,
}: {
  label: string;
  hint: string;
  amount: string;
  extra: string;
  loading: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-3 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2 text-muted-foreground">
        <WalletIcon className="size-3.5" />
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-28" />
      ) : (
        <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums">
          {amount}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{extra}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
