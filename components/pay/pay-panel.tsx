"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { ConnectReady } from "@/components/pay/connect-ready";
import { OnboardingSteps } from "@/components/pay/onboarding-steps";
import { ShieldButton } from "@/components/pay/shield-button";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseUsdc } from "@/lib/amount";
import {
  recordActivity,
  removeActivity,
  sameAddress,
  updateActivity,
} from "@/lib/pay/activity";
import { CIRCLE_FAUCET_URL } from "@/lib/pay/testnet";
import { parsePaymentLink, parsePaymentRequest } from "@/lib/pay/request";
import { transferPrivate } from "@/lib/starknet/actions";
import { extractTxHash, formatStrk20Error } from "@/lib/starknet/errors";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";
import { shortenAddress } from "@/lib/format";

import { useAccountPresence } from "./use-account-presence";
import { usePoolRegistration } from "./use-pool-registration";
import { useUsdcMaturity } from "./use-usdc-maturity";

const PRESETS = ["2", "5", "10", "25"];

function isOpenAmount(kind?: string, amount?: string) {
  return (
    !amount && (kind === "donation" || kind === "drop" || kind === undefined)
  );
}

export function PayPanel() {
  const searchParams = useSearchParams();
  const { network, setNetwork, starknet } = useNetwork();
  const { session, privateRaw, balancesLoading, balances, refreshBalances } =
    useTreasury();
  const usdc = getShieldToken("usdc", network);
  const fromQuery = useMemo(
    () => parsePaymentRequest(searchParams, network),
    [searchParams, network],
  );
  const [pasted, setPasted] = useState("");
  const [fromPaste, setFromPaste] = useState(
    () => parsePaymentLink(pasted, network),
  );
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [donationAmount, setDonationAmount] = useState("");

  const request = fromQuery ?? fromPaste;
  const openAmount = request
    ? isOpenAmount(request.kind, request.amount)
    : false;
  const amountText = request?.amount || donationAmount;
  const recipientPresence = useAccountPresence(request?.to);
  const recipientRegistration = usePoolRegistration(request?.to);
  const notes = useUsdcMaturity(session?.address, privateRaw);
  const publicUsdc = balances?.usdcRaw ?? BigInt(0);
  const creatorReady =
    !!request &&
    recipientPresence === "deployed" &&
    recipientRegistration === "registered";
  const creatorBlocked =
    !!request &&
    (recipientPresence === "undeployed" ||
      recipientRegistration === "unregistered");
  const canDonate =
    !!session &&
    !!request &&
    creatorReady &&
    notes.ready &&
    privateRaw > BigInt(0);

  useEffect(() => {
    if (fromQuery && fromQuery.network !== network) {
      setNetwork(fromQuery.network);
    }
  }, [fromQuery, network, setNetwork]);

  async function handlePay() {
    if (!session || !request) return;
    setError(null);
    setPaying(true);
    let amount: bigint;
    try {
      amount = parseUsdc(amountText);
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
      setPaying(false);
      return;
    }
    if (privateRaw < amount) {
      setError(
        formatStrk20Error(new Error("INSUFFICIENT_PRIVATE_BALANCE"), "pay"),
      );
      setPaying(false);
      return;
    }
    const pending = recordActivity({
      network,
      kind: "pay",
      source: "morok",
      status: "pending",
      amount: amountText,
      amountRaw: amount.toString(),
      invoice: request.invoice || undefined,
      label: request.label || undefined,
      from: session.address,
      to: request.to,
      counterparty: request.to,
      address: session.address,
    });
    const confirm = async (txHash: string | undefined) => {
      updateActivity(pending.id, { txHash, status: "confirmed" });
      toast.success("Donated privately", {
        description: txHash,
        action: txHash
          ? {
              label: "Voyager",
              onClick: () =>
                window.open(
                  `${starknet.explorer}/tx/${txHash}`,
                  "_blank",
                  "noopener,noreferrer",
                ),
            }
          : undefined,
      });
      await refreshBalances({ private: false });
    };

    const giveUp = (caught: unknown) => {
      removeActivity(pending.id);
      setError(formatStrk20Error(caught, "pay"));
    };

    try {
      const response = await transferPrivate(
        session.account,
        usdc,
        amount,
        request.to,
      );
      await confirm(extractTxHash(response));
    } catch (caught) {
      const txHash = extractTxHash(caught);
      if (txHash) await confirm(txHash);
      else giveUp(caught);
    } finally {
      setPaying(false);
    }
  }

  const linkStatus = request ? "done" : "current";
  const readyStatus = request
    ? session
      ? "done"
      : "current"
    : "upcoming";
  const shieldStatus = !request || !session
    ? "upcoming"
    : privateRaw > BigInt(0)
      ? "done"
      : "current";
  const waitStatus =
    !request || !session || privateRaw <= BigInt(0)
      ? "upcoming"
      : notes.ready
        ? "done"
        : "current";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Donate</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {network === "sepolia"
            ? "Sepolia: shield test USDC, wait for the note to mature, then pay. The QR never shows the amount."
            : "Shield USDC, wait a couple of minutes, then pay. The shared QR never shows how much you chose."}
        </p>
      </div>

      <OnboardingSteps
        title="Get ready to donate"
        description="Ready must be on the same network as the QR. New notes take about ten blocks before they can move."
        doneLabel={`Ready · ${formatUsdc(privateRaw)} private USDC · notes mature`}
        steps={[
          {
            id: "link",
            title: request?.label
              ? `Open “${request.label}”`
              : "Open a donation link",
            body: "Scan the creator QR or paste the link they sent you.",
            status: linkStatus,
            children:
              linkStatus === "current" ? (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="pay-link">Donation link</FieldLabel>
                    <Input
                      id="pay-link"
                      value={pasted}
                      inputMode="url"
                      placeholder="/pay?to=0x…&kind=donation"
                      onChange={(event) => {
                        const value = event.target.value;
                        setPasted(value);
                        setFromPaste(parsePaymentLink(value, network));
                        setError(null);
                      }}
                    />
                  </Field>
                </FieldGroup>
              ) : null,
          },
          {
            id: "ready",
            title: "Connect Ready",
            body: "Use Ready X on the same network as the header.",
            status: readyStatus,
            children: readyStatus === "current" ? <ConnectReady /> : null,
          },
          {
            id: "shield",
            title: "Shield USDC",
            body:
              publicUsdc <= BigInt(0)
                ? "You need public USDC on this Ready, then shield it into the pool."
                : "Move USDC into the private wallet. The pool fee comes out of this amount.",
            status: shieldStatus,
            children:
              shieldStatus === "current" ? (
                <>
                  {publicUsdc <= BigInt(0) ? (
                    <div className="flex flex-wrap gap-2">
                      {network === "sepolia" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className="min-h-12"
                          nativeButton={false}
                          render={
                            <a
                              href={CIRCLE_FAUCET_URL}
                              target="_blank"
                              rel="noreferrer"
                            />
                          }
                        >
                          Get test USDC
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className="min-h-12"
                          nativeButton={false}
                          render={<a href="/treasury" />}
                        >
                          Top up from Base
                        </Button>
                      )}
                    </div>
                  ) : null}
                  <ShieldButton token="usdc" />
                </>
              ) : null,
          },
          {
            id: "wait",
            title: "Wait for the note",
            body: notes.ready
              ? "This USDC can move."
              : `New notes mature in about ten blocks. Donate when this hits 0:00 — Ready will reject a spend before that.`,
            status: waitStatus,
            children:
              waitStatus === "current" ? (
                <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
                  {notes.remainingLabel}
                </p>
              ) : null,
          },
        ]}
      />

      {request && session && (canDonate || creatorBlocked) ? (
        <Card>
          <CardHeader>
            <CardTitle>{request.label || "Private donation"}</CardTitle>
            <CardDescription>
              To {shortenAddress(request.to)} on Starknet {request.network}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {openAmount ? (
              <Field>
                <FieldLabel htmlFor="payment-amount">Amount (USDC)</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="lg"
                      variant={donationAmount === preset ? "default" : "outline"}
                      className="min-h-10 min-w-16"
                      onClick={() => {
                        setDonationAmount(preset);
                        setError(null);
                      }}
                    >
                      {preset}
                    </Button>
                  ))}
                </div>
                <Input
                  id="payment-amount"
                  className="mt-2"
                  inputMode="decimal"
                  placeholder="Or enter an amount"
                  value={donationAmount}
                  onChange={(event) => {
                    setDonationAmount(event.target.value);
                    setError(null);
                  }}
                />
                <FieldDescription>
                  This amount stays off the shared QR. Activity records your
                  Ready as From and the creator as To.
                </FieldDescription>
              </Field>
            ) : (
              <p className="font-mono text-sm tabular-nums">
                {request.amount} USDC
              </p>
            )}
            {session ? (
              <p className="text-sm tabular-nums">
                Your private USDC:{" "}
                {balancesLoading && privateRaw === BigInt(0)
                  ? "…"
                  : formatUsdc(privateRaw)}
              </p>
            ) : null}
            {session && request && sameAddress(request.to, session.address) ? (
              <Alert>
                <AlertTitle>This is your own QR</AlertTitle>
                <AlertDescription>
                  Paying it only costs the pool fee. Use a second Ready to see a
                  real donation land.
                </AlertDescription>
              </Alert>
            ) : null}
            {request && recipientPresence === "undeployed" ? (
              <Alert>
                <AlertTitle>
                  Creator is not on Starknet {request.network} yet
                </AlertTitle>
                <AlertDescription>
                  Ask them to open My QR and activate with STRK, then try again.
                </AlertDescription>
              </Alert>
            ) : null}
            {request &&
            recipientPresence !== "undeployed" &&
            recipientRegistration === "unregistered" ? (
              <Alert>
                <AlertTitle>Creator has not activated STRK20</AlertTitle>
                <AlertDescription>
                  Ask them to shield STRK once on My QR before you donate.
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not donate</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="border-t">
            {session ? (
              <Button
                type="button"
                size="lg"
                className="min-h-12"
                disabled={
                  paying ||
                  !canDonate ||
                  !amountText.trim()
                }
                aria-busy={paying}
                onClick={() => {
                  void handlePay();
                }}
              >
                {paying ? <Spinner data-icon="inline-start" /> : null}
                {paying ? "Donating" : `Donate ${amountText || "…"} USDC`}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Finish the steps above, then confirm in Ready.
              </p>
            )}
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}
