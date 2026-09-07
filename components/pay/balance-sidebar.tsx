"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { erc20Abi, type Address } from "viem";
import { useReadContract } from "wagmi";
import { ArrowDownToLineIcon, CoinsIcon, RefreshCwIcon, WalletIcon } from "lucide-react";

import { HistoryModal } from "@/components/pay/history-modal";
import { useNetwork } from "@/components/network-provider";
import { BridgeOutButton } from "@/components/pay/bridge-out-button";
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
import type { AppNetwork } from "@/lib/network";

export function BalanceSidebar() {
  const {
    session,
    balances,
    balancesLoading,
    refreshBalances,
    connectEvm,
    evmStarknetAddress,
    evmConnectedAddress,
  } =
    useTreasury();
  const { network, cctp, baseChain } = useNetwork();
  const pathname = usePathname();
  /* /start is the funding flow. Offering Top up and Get STRK beside it points
     at two smaller versions of the steps already on the page. */
  const showFunding = pathname !== "/start";

  /* The balance that decides whether the first step is even possible, read
     where somebody is looking at their empty Starknet one and wondering what
     to do. Only Base: it is the chain MorokPay actually bridges from, so it
     is the only number here that can be acted on. */
  const { data: baseUsdc } = useReadContract({
    address: cctp.usdc as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: evmConnectedAddress ? [evmConnectedAddress as Address] : undefined,
    chainId: baseChain.id,
    query: { enabled: Boolean(evmConnectedAddress) },
  });
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

  /* One number for "not private yet", wherever it sits. Held back until both
     halves have answered: a total that climbs as each read lands looks like
     money arriving. */
  const baseKnown = !evmConnectedAddress || baseUsdc !== undefined;
  const starknetKnown = !session || !loading;
  const publicTotalKnown = baseKnown && starknetKnown;
  const publicTotal =
    (baseUsdc ?? BigInt(0)) + (session ? publicUsdc : BigInt(0));

  /* Nothing connected means nothing to balance. The card used to sit there
     restating the header's own invitation under a heading promising numbers
     it had none of, so it stands down to the two things still worth doing
     with no wallet at all. A connected wallet without a session keeps the
     card: its public side is real and its message is specific. */
  if (!session && !evmStarknetAddress) {
    if (!showFunding) return null;
    return (
      <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
        <FundingLinks network={network} />
      </aside>
    );
  }

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>Balances</CardTitle>
              {/* "Public Starknet and private donation wallet" described our
                  plumbing, and named a product narrower than this one. */}
              <CardDescription>What is public, and what is not.</CardDescription>
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

          {/* Base and Starknet are one thing to the person holding them:
              money that is not private yet. They are two things to us,
              because moving each costs something different - the bridge is
              on us, the shield is 6 STRK of pool fee out of their own
              pocket. So: one heading and one total, two rows and two
              buttons. The intermediate Starknet balance is an
              implementation detail nobody arrived wanting to learn, and it
              reads as one here without pretending the actions are alike. */}
          {evmConnectedAddress || session ? (
            <div className="rounded-xl bg-muted/40 px-3 py-3 ring-1 ring-foreground/10">
              <div className="flex items-center gap-2 text-muted-foreground">
                <WalletIcon className="size-3.5" />
                <p className="text-xs font-medium uppercase tracking-wide">
                  Public
                </p>
              </div>
              {publicTotalKnown ? (
                <p className="mt-2 font-mono text-xl font-semibold tracking-tight tabular-nums">
                  {formatUsdc(publicTotal)} USDC
                </p>
              ) : (
                <Skeleton className="mt-2 h-7 w-28" />
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Not private yet. Anyone can see it.
              </p>

              <div className="mt-3 flex flex-col gap-4 border-t border-foreground/10 pt-3">
                {evmConnectedAddress ? (
                  <PlaceRow
                    label={`On ${baseChain.name}`}
                    amount={baseUsdc}
                    note="MorokPay pays to deliver it to Starknet."
                    action={
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          nativeButton={false}
                          render={<Link href="/treasury" />}
                        >
                          <ArrowDownToLineIcon />
                          Bridge
                        </Button>
                      </div>
                    }
                  />
                ) : null}
                {session ? (
                  <PlaceRow
                    label="On Starknet"
                    amount={loading ? undefined : publicUsdc}
                    note={`${formatStrk(publicStrk)} STRK for gas`}
                    action={
                      <div className="flex flex-col gap-3">
                        <ShieldButton />
                        <div className="flex justify-end gap-2">
                          <BridgeOutButton />
                          <SendButton />
                        </div>
                      </div>
                    }
                  />
                ) : null}
              </div>
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
        {showFunding ? (
          <div className="border-t px-6 py-4">
            <FundingLinks network={network} />
          </div>
        ) : null}
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

/** One place the public money can sit, and what can be done to it there. */
function PlaceRow({
  label,
  amount,
  note,
  action,
}: {
  label: string;
  /** Undefined while the read is in flight. */
  amount: bigint | undefined;
  note: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium">{label}</p>
        {amount === undefined ? (
          <Skeleton className="h-4 w-20" />
        ) : (
          <p className="font-mono text-sm font-semibold tabular-nums">
            {formatUsdc(amount)} USDC
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
      <div className="mt-1">{action}</div>
    </div>
  );
}

/**
 * Funding lives with the balance it changes. Both were top-level nav items,
 * which is a strange place for "my number is too small": you only want them
 * while looking at the number. Get STRK routes through AVNU and there is no
 * Sepolia liquidity to route against, so it is mainnet only; Top up bridges
 * on both.
 */
function FundingLinks({ network }: { network: AppNetwork }) {
  return (
    <div className="flex flex-wrap gap-2">
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
  );
}
