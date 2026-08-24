"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  RefreshCwIcon,
  WalletIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ShieldButton } from "@/components/pay/shield-button";
import { UnshieldButton } from "@/components/pay/unshield-button";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { shortenAddress } from "@/lib/format";
import {
  activityParties,
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
  switch (item.kind) {
    case "pay":
      return {
        title: item.status === "pending" ? "Sending" : "Sent",
        icon: ArrowUpRightIcon,
        sign: "−" as const,
      };
    case "receive":
      return {
        title: "Received",
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

async function copyAddress(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Address copied");
  } catch {
    toast.error("Could not copy address");
  }
}

function WalletLine({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  if (!value) {
    return (
      <p className="text-[11px] text-muted-foreground">
        {label} Hidden
      </p>
    );
  }
  return (
    <p className="flex min-w-0 items-baseline gap-1.5 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <button
        type="button"
        className="min-w-0 truncate font-mono tabular-nums underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        title={value}
        onClick={() => {
          void copyAddress(value);
        }}
      >
        {shortenAddress(value)}
      </button>
    </p>
  );
}

function ActivityParties({ item }: { item: ActivityItem }) {
  const { from, to } = activityParties(item);
  if (item.kind === "shield" || item.kind === "unshield") {
    return <WalletLine label="Wallet" value={from ?? to} />;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <WalletLine label="From" value={from} />
      <WalletLine label="To" value={to} />
    </div>
  );
}

export function BalanceSidebar() {
  const { network, starknet } = useNetwork();
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
                Public Ready and private donation wallet.
              </CardDescription>
            </div>
            {session ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Refresh balances (asks Ready to share private balances)"
                title="Refresh — Ready will ask to share private balances once"
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
              Connect Ready to see public and private USDC.
            </p>
          ) : (
            <>
              <BalanceRow
                label="Wallet"
                hint="Public Ready account"
                loading={loading}
                amount={`${formatUsdc(publicUsdc)} USDC`}
                extra={`${formatStrk(publicStrk)} public STRK for gas · ${formatStrk(balances?.privateStrk ?? BigInt(0))} shielded`}
                action={<ShieldButton />}
              />
              <BalanceRow
                label="Private"
                hint="STRK20 pool"
                loading={loading}
                amount={`${formatUsdc(privateUsdc)} USDC`}
                extra={
                  balances?.privateError
                    ? balances.privateError
                    : "Ready holds the viewing key"
                }
                action={<UnshieldButton />}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Donations this browser recorded. Incoming sender is hidden by the
            pool; destination is this Ready.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!session ? (
            <p className="text-sm text-muted-foreground">
              Donations and top-ups show up here after you connect.
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No movement yet. Ready keeps the full history; this list is what
              this browser can see.
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
                          {item.label ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {item.label}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <p className="shrink-0 font-mono text-sm tabular-nums">
                        {copy.sign}
                        {item.amount} USDC
                      </p>
                    </div>
                    <div className="mt-1.5 flex items-end justify-between gap-2">
                      <ActivityParties item={item} />
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {item.txHash ? (
                          <a
                            href={`${starknet.explorer}/tx/${item.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2"
                          >
                            Voyager
                          </a>
                        ) : (
                          new Date(item.at).toLocaleString()
                        )}
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
        <p className="mt-2 font-mono text-xl font-semibold tracking-tight tabular-nums">
          {amount}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{extra}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
