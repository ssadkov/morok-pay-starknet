"use client";

import type { ReactNode } from "react";
import { RefreshCwIcon, WalletIcon } from "lucide-react";

import { ShieldButton } from "@/components/pay/shield-button";
import { UnshieldButton } from "@/components/pay/unshield-button";
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
import { formatStrk, formatUsdc } from "@/lib/starknet/status";

export function BalanceSidebar() {
  const { session, balances, balancesLoading, refreshBalances } = useTreasury();
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
                Public Starknet and private donation wallet.
              </CardDescription>
            </div>
            {session ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Refresh public and private balances"
                title="Refresh balances"
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
              Connect Ready or an EVM wallet to see balances.
            </p>
          ) : (
            <>
              <BalanceRow
                label="Wallet"
                hint="Public Starknet account"
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
                secondaryAmount={`${formatStrk(balances?.privateStrk ?? BigInt(0))} STRK shielded`}
                extra={
                  balances?.privateError
                    ? balances.privateError
                    : session.kind === "evm"
                      ? "Viewing key derived in this browser session"
                      : "Ready holds the viewing key"
                }
                action={<UnshieldButton />}
              />
            </>
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
  secondaryAmount,
  extra,
  loading,
  action,
}: {
  label: string;
  hint: string;
  amount: string;
  secondaryAmount?: string;
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
      {!loading && secondaryAmount ? (
        <p className="mt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
          {secondaryAmount}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{extra}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
