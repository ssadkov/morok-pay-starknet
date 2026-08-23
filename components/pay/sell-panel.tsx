"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CopyIcon } from "lucide-react";

import { ConnectPanel } from "@/components/treasury/connect-panel";
import { QrCode } from "@/components/pay/qr-code";
import { ShieldButton } from "@/components/pay/shield-button";
import { TestnetHint } from "@/components/pay/testnet-hint";
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
import { sameAddress } from "@/lib/pay/activity";
import {
  nextInvoiceId,
  readInvoices,
  saveInvoice,
  subscribeInvoices,
  type MerchantInvoice,
} from "@/lib/pay/invoices";
import { paymentUrl, type PaymentRequest } from "@/lib/pay/request";
import { formatUsdc } from "@/lib/starknet/status";

import { useAccountPresence } from "./use-account-presence";
import { usePoolRegistration } from "./use-pool-registration";

const EMPTY: MerchantInvoice[] = [];
const DEFAULT_LABEL = "Support the channel";

function useInvoices(network: ReturnType<typeof useNetwork>["network"]) {
  return useSyncExternalStore(
    subscribeInvoices,
    () => readInvoices(network),
    () => EMPTY,
  );
}

function donationFor(
  invoices: MerchantInvoice[],
  address: string,
): MerchantInvoice | undefined {
  return invoices.find(
    (entry) =>
      sameAddress(entry.to, address) &&
      (entry.kind === "donation" || entry.kind === "drop" || !entry.amount),
  );
}

export function SellPanel() {
  const { network } = useNetwork();
  const { session, privateRaw, balancesLoading } = useTreasury();
  const invoices = useInvoices(network);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<PaymentRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presence = useAccountPresence(session?.address);
  const registration = usePoolRegistration(session?.address);
  const canReceive = presence !== "undeployed" && registration !== "unregistered";

  const stored = session
    ? donationFor(invoices, session.address)
    : undefined;
  const request =
    created?.network === network ? created : stored ?? null;

  const payUrl = useMemo(() => {
    if (!request || typeof window === "undefined") return "";
    return paymentUrl(window.location.origin, request);
  }, [request]);

  async function handleCreate() {
    if (!session) return;
    setError(null);
    setCreating(true);
    try {
      if (!canReceive) {
        throw new Error("Activate STRK20 on this network before creating a QR");
      }
      const next: PaymentRequest = {
        network,
        to: session.address,
        amount: "",
        invoice: stored?.invoice || nextInvoiceId("TIP"),
        label: label.trim() || stored?.label || DEFAULT_LABEL,
        kind: "donation",
      };
      saveInvoice({
        ...next,
        createdAt: stored?.createdAt ?? Date.now(),
        status: "unpaid",
      });
      setCreated(next);
      setLabel("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create QR");
    } finally {
      setCreating(false);
    }
  }

  async function copyUrl() {
    if (!payUrl) return;
    try {
      await navigator.clipboard.writeText(payUrl);
      toast.success("Donation link copied");
    } catch {
      toast.error("Could not copy link");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">My donation QR</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          One durable link. Supporters choose the amount. Incoming USDC shows in
          Activity with this Ready as the destination.
        </p>
      </div>
      <TestnetHint />

      {!session ? <ConnectPanel /> : null}

      {presence === "undeployed" || registration === "unregistered" ? (
        <Alert>
          <AlertTitle>Activate STRK20 first</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>
              Shield once on {network} so the pool can credit private notes to
              this Ready. Then share the QR.
            </p>
            <ShieldButton />
          </AlertDescription>
        </Alert>
      ) : null}

      {session && canReceive && !request ? (
        <Card>
          <CardHeader>
            <CardTitle>Create your QR</CardTitle>
            <CardDescription>
              Private USDC on this Ready:{" "}
              {balancesLoading && privateRaw === BigInt(0)
                ? "…"
                : `${formatUsdc(privateRaw)} USDC`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="donation-label">Label</FieldLabel>
                <Input
                  id="donation-label"
                  value={label}
                  placeholder={DEFAULT_LABEL}
                  onChange={(event) => setLabel(event.target.value)}
                />
                <FieldDescription>
                  Shown on the pay screen. Amount stays off the QR.
                </FieldDescription>
              </Field>
            </FieldGroup>
            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Could not create QR</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="border-t">
            <Button
              type="button"
              size="lg"
              className="min-h-12"
              disabled={creating}
              aria-busy={creating}
              onClick={() => {
                void handleCreate();
              }}
            >
              Create donation QR
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {request && payUrl ? (
        <Card>
          <CardHeader>
            <CardTitle>{request.label || DEFAULT_LABEL}</CardTitle>
            <CardDescription>
              Open amount · supporters pick how much
              {request.network === "sepolia" ? " · Sepolia" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <QrCode
              value={payUrl}
              label={`Private donation to ${request.label || DEFAULT_LABEL}`}
            />
            <p className="break-all font-mono text-xs text-muted-foreground">
              {payUrl}
            </p>
            <p className="text-sm text-muted-foreground">
              First 10 contest: post this link. Amount never appears on the QR.
            </p>
          </CardContent>
          <CardFooter className="border-t">
            <Button
              type="button"
              size="lg"
              className="min-h-12"
              onClick={() => {
                void copyUrl();
              }}
            >
              <CopyIcon data-icon="inline-start" />
              Copy link
            </Button>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}
