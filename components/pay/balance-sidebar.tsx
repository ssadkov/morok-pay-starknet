"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDownToLineIcon, CoinsIcon, RefreshCwIcon, WalletIcon } from "lucide-react";

import { HistoryModal } from "@/components/pay/history-modal";
import { useNetwork } from "@/components/network-provider";
import { SendButton } from "@/components/pay/send-button";
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
  const {
    session,
    balances,
    balancesLoading,
    refreshBalances,
    connectEvm,
    evmStarknetAddress,
  } =
    useTreasury();
  const { network } = useNetwork();
  /* Deployed but not registered: everything public works, nothing private
     does. Re-running the connect check is what raises the activation flow, so
     this is a way back to it rather than a second copy of it. */
  const needsActivation = session?.kind === "evm" && !session.privacyReady;
  const loading = balancesLoading && !balances;
  const publicUsdc = balances?.usdcRaw ?? BigInt(0);
  const publicStrk = balances?.strkWei ?? BigInt(0);
  const privateUsdc = balances?.privateUsdc ?? BigInt(0);
  /* A failed note read leaves the amounts at their seed value. Printing that
     zero in the same large type as a real balance is the one thing this card
     must not do - it reads as "your money is gone" when it means "we could
     not look". */
  const privateUnknown = balances ? !balances.privateKnown : false;

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
                disabled={balancesLoading}
                aria-busy={balancesLoading}
                onClick={() => {
                  void refreshBalances();
                }}
              >
                {/* Balances are usually already on screen, so the skeletons
                    below stay hidden on a refresh - without this the click
                    looks like it did nothing. */}
                <RefreshCwIcon
                  className={balancesLoading ? "animate-spin" : undefined}
                />
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {needsActivation ? (
            <div className="flex flex-col gap-2 rounded-xl bg-muted/40 px-3 py-3 ring-1 ring-foreground/10">
              <p className="text-sm font-medium">Privacy is not activated</p>
              <p className="text-xs text-muted-foreground">
                This account can hold, swap and send in public. Receiving
                privately needs a one-time activation, paid in STRK.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => void connectEvm()}
              >
                Activate privacy
              </Button>
            </div>
          ) : null}

          {!session ? (
            /* A connected wallet with no session is not a disconnected one.
               The session appears once the derived account is deployed on a
               class this app can drive - a claim recipient may sit outside
               that for good - and telling them to connect a wallet they have
               already connected is how the claim page hid an invoice from the
               only wallet that could take it. Private balances genuinely need
               the session, because they need a viewing key; the public side
               needs only an address. */
            <p className="text-sm text-muted-foreground">
              {evmStarknetAddress
                ? "This wallet has no Starknet account this app can read yet. Public balances live at the address in the header menu; private ones need privacy activated."
                : "Connect Ready X or an EVM wallet to see balances."}
            </p>
          ) : (
            <>
              <BalanceRow
                label="Wallet"
                hint="Public Starknet account"
                loading={loading}
                amount={`${formatUsdc(publicUsdc)} USDC`}
                extra={`${formatStrk(publicStrk)} public STRK for gas · ${formatStrk(balances?.privateStrk ?? BigInt(0))} shielded`}
                action={
                  <div className="flex flex-col gap-3">
                    <ShieldButton />
                    <div className="flex justify-end">
                      <SendButton />
                    </div>
                  </div>
                }
              />
              <BalanceRow
                label="Private"
                hint="STRK20 pool"
                loading={loading}
                amount={
                  privateUnknown ? "—" : `${formatUsdc(privateUsdc)} USDC`
                }
                secondaryAmount={
                  privateUnknown
                    ? "Balance not read"
                    : `${formatStrk(balances?.privateStrk ?? BigInt(0))} STRK shielded`
                }
                extra={
                  balances?.privateError
                    ? balances.privateError
                    : session.kind === "evm"
                      ? "Viewing key derived in this browser session"
                      : "Ready X holds the viewing key"
                }
                action={
                  <div className="flex flex-col gap-3">
                    <UnshieldButton />
                    <div className="flex justify-end gap-2">
                      <HistoryModal />
                      <SendButton mode="private" />
                    </div>
                  </div>
                }
              />
            </>
          )}
        </CardContent>
        {/* Funding lives with the balance it changes. Both were top-level nav
            items, which is a strange place for "my number is too small": you
            only want them while looking at the number. Get STRK routes
            through AVNU and there is no Sepolia liquidity to route against,
            so it is mainnet only; Top up bridges on both. */}
        <div className="flex flex-wrap gap-2 border-t px-6 py-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href="/treasury" />}
          >
            <ArrowDownToLineIcon />
            Top up
          </Button>
          {network === "mainnet" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/swap" />}
            >
              <CoinsIcon />
              Get STRK
            </Button>
          ) : null}
        </div>
      </Card>
      {/* The lab runs the same steps with the proof, the fee and the resource
          bounds shown one at a time. That is the right shape for diagnosing a
          failure and the wrong shape for an everyday shield, so it sits here
          rather than in place of the buttons. */}
      {session?.kind === "evm" ? (
        <p className="px-1 text-center text-xs text-muted-foreground">
          <Link
            href="/privacy-sdk-lab"
            className="underline underline-offset-4"
          >
            Run each step yourself in the EVM lab
          </Link>
        </p>
      ) : null}
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
