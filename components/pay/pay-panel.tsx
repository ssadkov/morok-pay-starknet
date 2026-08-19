"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { TestnetHint } from "@/components/pay/testnet-hint";
import { ConnectPanel } from "@/components/treasury/connect-panel";
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
import {
  parsePaymentLink,
  parsePaymentRequest,
  type PaymentKind,
} from "@/lib/pay/request";
import { transferPrivate } from "@/lib/starknet/actions";
import { extractTxHash, formatStrk20Error } from "@/lib/starknet/errors";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";
import { shortenAddress } from "@/lib/format";

import { useAccountPresence } from "./use-account-presence";
import { usePoolRegistration } from "./use-pool-registration";

const KIND_COPY: Record<PaymentKind, string> = {
  invoice: "Private USDC invoice",
  sale: "Private USDC purchase",
  donation: "Private USDC donation",
  drop: "MorokPay Private Drop",
};

export function PayPanel() {
  const searchParams = useSearchParams();
  const { network, setNetwork, starknet } = useNetwork();
  const {
    session,
    privateRaw,
    balancesLoading,
    refreshBalances,
  } = useTreasury();
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
  const amountText = request?.amount || donationAmount;
  const recipientPresence = useAccountPresence(request?.to);
  const recipientRegistration = usePoolRegistration(request?.to);

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
      setError(formatStrk20Error(new Error("INSUFFICIENT_PRIVATE_BALANCE"), "pay"));
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
      counterparty: request.to,
      address: session.address,
    });
    const confirm = async (txHash: string | undefined) => {
      updateActivity(pending.id, { txHash, status: "confirmed" });
      toast.success("Paid privately", {
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

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Pay privately</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {network === "sepolia"
            ? "Sepolia: send shielded test USDC to a registered Ready. The reference stays in this payment link; the transfer itself remains inside STRK20."
            : "Send shielded USDC to a registered Ready. Use the same QR flow for an invoice, a purchase, a donation, or a Private Drop reward."}
        </p>
      </div>
      <TestnetHint />

      {!fromQuery ? (
        <Card>
          <CardHeader>
            <CardTitle>Open a request</CardTitle>
            <CardDescription>
              Paste a MorokPay payment link if you did not scan a QR.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="pay-link">Payment link</FieldLabel>
                <Input
                  id="pay-link"
                  value={pasted}
                  inputMode="url"
                  placeholder="/pay?to=0x…&amount=12.50&inv=INV-9K2M"
                  onChange={(event) => {
                    const value = event.target.value;
                    setPasted(value);
                    setFromPaste(parsePaymentLink(value, network));
                    setError(null);
                  }}
                />
                <FieldDescription>
                  Ask the merchant for a QR, or paste the link they sent you.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}

      {request ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {request.label || KIND_COPY[request.kind ?? "invoice"]}
            </CardTitle>
            <CardDescription>
              {request.amount ? `${request.amount} USDC` : "Choose your amount"}
              {request.invoice ? ` · ${request.invoice}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              To {shortenAddress(request.to)} on Starknet {request.network}.
            </p>
            <p className="text-sm text-muted-foreground">
              Ready creates a normal private transfer inside the pool. The
              label and reference are not written on-chain.
            </p>
            {!request.amount &&
            (request.kind === "donation" || request.kind === "drop") ? (
              <Field>
                <FieldLabel htmlFor="payment-amount">
                  {request.kind === "drop" ? "Reward" : "Donation"} (USDC)
                </FieldLabel>
                <Input
                  id="payment-amount"
                  inputMode="decimal"
                  placeholder="5.00"
                  value={donationAmount}
                  onChange={(event) => {
                    setDonationAmount(event.target.value);
                    setError(null);
                  }}
                />
                <FieldDescription>
                  The recipient gets a private STRK20 transfer. Your chosen
                  amount is not added to the shared QR.
                </FieldDescription>
              </Field>
            ) : null}
            {session ? (
              <p className="text-sm tabular-nums">
                Your private USDC:{" "}
                {balancesLoading && privateRaw === BigInt(0)
                  ? "…"
                  : formatUsdc(privateRaw)}
              </p>
            ) : null}
            {session && sameAddress(request.to, session.address) ? (
              <Alert>
                <AlertTitle>Paying your own Ready</AlertTitle>
                <AlertDescription>
                  This invoice is addressed to the connected account, so
                  Payment wallet USDC will only drop by the pool fee. Use a
                  second Ready profile as the merchant to see a real private
                  transfer.
                </AlertDescription>
              </Alert>
            ) : null}
            {recipientPresence === "undeployed" ? (
              <Alert>
                <AlertTitle>Merchant is not on Starknet {network} yet</AlertTitle>
                <AlertDescription>
                  This address has never transacted on {network}, so the pool
                  cannot credit a private note to it. Use a claim link from Get
                  paid instead — that parks the USDC until they join the pool.
                </AlertDescription>
              </Alert>
            ) : null}
            {recipientPresence !== "undeployed" &&
            recipientRegistration === "unregistered" ? (
              <Alert>
                <AlertTitle>Recipient has not activated STRK20</AlertTitle>
                <AlertDescription>
                  This Ready address has no public key registered in the pool.
                  Ask its owner to shield once before you pay this request.
                </AlertDescription>
              </Alert>
            ) : null}
            {privateRaw === BigInt(0) && session ? (
              <Alert>
                <AlertTitle>No private USDC yet</AlertTitle>
                <AlertDescription>
                  <Link href="/treasury" className="underline underline-offset-4">
                    {network === "sepolia"
                      ? "Get test USDC, then shield"
                      : "Top up from Base and shield"}
                  </Link>{" "}
                  before paying.
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not pay</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="border-t">
            {session ? (
              <Button
                type="button"
                size="lg"
                className="min-h-10"
                disabled={
                  paying ||
                  privateRaw === BigInt(0) ||
                  recipientPresence === "undeployed"
                  || !amountText.trim()
                  || recipientRegistration === "unregistered"
                }
                aria-busy={paying}
                onClick={() => {
                  void handlePay();
                }}
              >
                {paying ? <Spinner data-icon="inline-start" /> : null}
                {paying ? "Paying" : `Pay ${amountText || "…"} USDC`}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect Ready above to confirm this payment.
              </p>
            )}
          </CardFooter>
        </Card>
      ) : null}

      {!session ? <ConnectPanel /> : null}
    </div>
  );
}
