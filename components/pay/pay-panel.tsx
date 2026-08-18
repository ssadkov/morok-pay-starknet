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
import { recordActivity } from "@/lib/pay/activity";
import { parsePaymentLink, parsePaymentRequest } from "@/lib/pay/request";
import { transferPrivate } from "@/lib/starknet/actions";
import { formatStrk20Error } from "@/lib/starknet/errors";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";
import { shortenAddress } from "@/lib/format";

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

  const request = fromQuery ?? fromPaste;

  useEffect(() => {
    if (fromQuery && fromQuery.network !== network) {
      setNetwork(fromQuery.network);
    }
  }, [fromQuery, network, setNetwork]);

  async function handlePay() {
    if (!session || !request) return;
    setError(null);
    setPaying(true);
    try {
      const amount = parseUsdc(request.amount);
      if (privateRaw < amount) {
        throw new Error("INSUFFICIENT_PRIVATE_BALANCE");
      }
      const response = await transferPrivate(
        session.account,
        usdc,
        amount,
        request.to,
        starknet.echoHelper
          ? { contract: starknet.echoHelper }
          : undefined,
      );
      recordActivity({
        network,
        kind: "pay",
        source: "morok",
        amount: request.amount,
        amountRaw: amount.toString(),
        invoice: request.invoice || undefined,
        label: request.label || undefined,
        counterparty: request.to,
        address: session.address,
        txHash: response.transaction_hash,
      });
      toast.success("Paid privately", {
        description: response.transaction_hash,
        action: {
          label: "Voyager",
          onClick: () =>
            window.open(
              `${starknet.explorer}/tx/${response.transaction_hash}`,
              "_blank",
              "noopener,noreferrer",
            ),
        },
      });
      await refreshBalances();
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
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
            ? "Sepolia: send shielded test USDC to a merchant Ready. Pool fee is 2 STRK. The invoice number stays on this request, not on-chain."
            : "Send shielded USDC to a merchant Ready address. The invoice number stays on this request so they can match the sale. It is not written on-chain yet."}
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
              {request.label || "Private USDC payment"}
            </CardTitle>
            <CardDescription>
              {request.amount} USDC
              {request.invoice ? ` · ${request.invoice}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              To {shortenAddress(request.to)} on Starknet {request.network}.
            </p>
            {session ? (
              <p className="text-sm tabular-nums">
                Your private USDC:{" "}
                {balancesLoading && privateRaw === BigInt(0)
                  ? "…"
                  : formatUsdc(privateRaw)}
              </p>
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
                disabled={paying || privateRaw === BigInt(0)}
                aria-busy={paying}
                onClick={() => {
                  void handlePay();
                }}
              >
                {paying ? <Spinner data-icon="inline-start" /> : null}
                {paying ? "Paying" : `Pay ${request.amount} USDC`}
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
