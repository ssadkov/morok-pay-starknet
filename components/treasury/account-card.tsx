"use client";

import { toast } from "sonner";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";

import { FundPanel } from "@/components/treasury/fund-panel";
import { PayoutPanel } from "@/components/treasury/payout-panel";
import { ShieldPanel } from "@/components/treasury/shield-panel";
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
import { EXPLORER_URL, STARKNET_NETWORK } from "@/lib/starknet/constants";
import { formatStrk, formatUsdc } from "@/lib/starknet/status";

export function AccountCard() {
  const { session, balances, balancesLoading, refreshBalances } = useTreasury();

  if (!session) return null;
  const ready = session;

  const explorerContract = `${EXPLORER_URL}/contract/${ready.address}`;
  const status = balancesLoading && !balances ? "loading" : balances?.status;
  const strkWei = balances?.strkWei ?? BigInt(0);
  const usdcRaw = balances?.usdcRaw ?? BigInt(0);
  const privateUsdc = balances?.privateUsdc ?? BigInt(0);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(ready.address);
      toast.success("Ready address copied");
    } catch {
      toast.error("Could not copy address");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Ready treasury</CardTitle>
          <CardDescription>
            Public balances on Starknet {STARKNET_NETWORK}. Private USDC lives
            in the shared STRK20 pool.
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
            <p className="text-xs text-muted-foreground">Ready address</p>
            <p className="break-all font-mono text-sm tabular-nums">
              {ready.address}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Public STRK</p>
            {balancesLoading && !balances ? (
              <Skeleton className="h-5 w-24" />
            ) : (
              <p className="font-mono text-sm tabular-nums">
                {formatStrk(strkWei)} STRK
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Public USDC</p>
            {balancesLoading && !balances ? (
              <Skeleton className="h-5 w-24" />
            ) : (
              <p className="font-mono text-sm tabular-nums">
                {formatUsdc(usdcRaw)} USDC
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Private USDC</p>
            {balancesLoading && !balances ? (
              <Skeleton className="h-5 w-24" />
            ) : (
              <p className="font-mono text-sm tabular-nums">
                {formatUsdc(privateUsdc)} USDC
              </p>
            )}
          </div>
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
      <FundPanel />
      <ShieldPanel />
      <PayoutPanel />
    </div>
  );
}
