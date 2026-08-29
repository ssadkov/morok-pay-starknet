"use client";

import { toast } from "sonner";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";

import { FundPanel } from "@/components/treasury/fund-panel";
import { PayoutPanel } from "@/components/treasury/payout-panel";
import { ShieldPanel } from "@/components/treasury/shield-panel";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatStrkBtc } from "@/lib/starknet/status";

export function AccountCard() {
  const { session, balances, balancesLoading, refreshBalances, tokens } =
    useTreasury();
  const { network, starknet } = useNetwork();

  if (!session) return null;
  const ready = session;

  const explorerContract = `${starknet.explorer}/contract/${ready.address}`;
  const status = balancesLoading && !balances ? "loading" : balances?.status;
  const strkBtcRaw = balances?.strkBtcRaw ?? BigInt(0);
  const privateStrkBtc = balances?.privateStrkBtc ?? BigInt(0);
  const showStrkBtc = tokens.some((token) => token.id === "strkbtc");

  const loading = balancesLoading && !balances;

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(ready.address);
      toast.success("Ready X address copied");
    } catch {
      toast.error("Could not copy address");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Ready X treasury</CardTitle>
          <CardDescription>
            Ready X address on Starknet {network}. Wallet and payment-wallet
            balances stay in the sidebar.
          </CardDescription>
          <CardAction>
            {status === "loading" || !status ? (
              <Skeleton className="h-5 w-28 rounded-full" />
            ) : (
              <Badge variant={status === "deployed" ? "default" : "secondary"}>
                {status === "deployed" ? "Connected" : "Account unknown"}
              </Badge>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Ready X address</p>
            <p className="break-all font-mono text-sm tabular-nums">
              {ready.address}
            </p>
          </div>
          {showStrkBtc ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">Public strkBTC</p>
              {loading ? (
                <Skeleton className="h-5 w-24" />
              ) : (
                <p className="font-mono text-sm tabular-nums">
                  {formatStrkBtc(strkBtcRaw)} strkBTC
                </p>
              )}
            </div>
          ) : null}
          {showStrkBtc ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">Private strkBTC</p>
              {loading ? (
                <Skeleton className="h-5 w-24" />
              ) : (
                <p className="font-mono text-sm tabular-nums">
                  {formatStrkBtc(privateStrkBtc)} strkBTC
                </p>
              )}
            </div>
          ) : null}
          {balances?.privateError ? (
            <Alert>
              <AlertTitle>Private balance unavailable</AlertTitle>
              <AlertDescription>{balances.privateError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-10"
            onClick={copyAddress}
          >
            <CopyIcon data-icon="inline-start" />
            Copy address
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="min-h-10"
            onClick={() =>
              window.open(explorerContract, "_blank", "noopener,noreferrer")
            }
          >
            <ExternalLinkIcon data-icon="inline-start" />
            Voyager
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="min-h-10"
            onClick={() => {
              void refreshBalances().catch(() => {
                toast.error("Could not refresh balances");
              });
            }}
          >
            Refresh
          </Button>
        </CardFooter>
      </Card>
      <ShieldPanel />
      <FundPanel />
      <PayoutPanel />
    </div>
  );
}
