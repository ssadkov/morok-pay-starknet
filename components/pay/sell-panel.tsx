"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CopyIcon } from "lucide-react";

import { ConnectPanel } from "@/components/treasury/connect-panel";
import { QrCode } from "@/components/pay/qr-code";
import { TestnetHint } from "@/components/pay/testnet-hint";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { parseUsdc } from "@/lib/amount";
import { recordMorokSale } from "@/lib/pay/activity";
import {
  nextInvoiceId,
  readInvoices,
  saveInvoice,
  subscribeInvoices,
  type MerchantInvoice,
} from "@/lib/pay/invoices";
import {
  paymentUrl,
  type PaymentKind,
  type PaymentRequest,
} from "@/lib/pay/request";
import { formatUsdc } from "@/lib/starknet/status";
import { shortenAddress } from "@/lib/format";

import { useAccountPresence } from "./use-account-presence";
import { usePoolRegistration } from "./use-pool-registration";

const EMPTY_INVOICES: MerchantInvoice[] = [];

const REQUEST_KINDS: Array<{
  value: PaymentKind;
  label: string;
  title: string;
  placeholder: string;
  prefix: string;
}> = [
  {
    value: "invoice",
    label: "Invoice",
    title: "New invoice",
    placeholder: "Consulting, order #42",
    prefix: "INV",
  },
  {
    value: "sale",
    label: "Sale",
    title: "Private checkout",
    placeholder: "Coffee, T-shirt, event ticket",
    prefix: "SALE",
  },
  {
    value: "donation",
    label: "Donation",
    title: "Private donation QR",
    placeholder: "Support my channel",
    prefix: "TIP",
  },
  {
    value: "drop",
    label: "Private Drop",
    title: "Private Drop entry",
    placeholder: "MorokPay Private Drop",
    prefix: "DROP",
  },
];

function useInvoices(network: ReturnType<typeof useNetwork>["network"]) {
  return useSyncExternalStore(
    subscribeInvoices,
    () => readInvoices(network),
    () => EMPTY_INVOICES,
  );
}

export function SellPanel() {
  const { network, starknet } = useNetwork();
  const { session, privateRaw, balancesLoading, refreshBalances } = useTreasury();
  const invoices = useInvoices(network);
  const [kind, setKind] = useState<PaymentKind>("invoice");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [invoice, setInvoice] = useState("");
  const [created, setCreated] = useState<PaymentRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presence = useAccountPresence(session?.address);
  const registration = usePoolRegistration(session?.address);
  const requestKind =
    REQUEST_KINDS.find((entry) => entry.value === kind) ?? REQUEST_KINDS[0];
  const canReceive = presence !== "undeployed" && registration !== "unregistered";
  const canCreate = canReceive && (kind !== "drop" || registration === "registered");
  const visibleCreated = created?.network === network ? created : null;

  const payUrl = useMemo(() => {
    if (!visibleCreated || typeof window === "undefined") return "";
    return paymentUrl(window.location.origin, visibleCreated);
  }, [visibleCreated]);

  async function handleCreate() {
    if (!session) return;
    setError(null);
    setCreating(true);
    try {
      if ((kind !== "donation" && kind !== "drop") || amount.trim()) {
        parseUsdc(amount);
      }
      if (!canCreate) {
        throw new Error("Activate STRK20 on this network before creating a QR");
      }
      const invoiceId = invoice.trim() || nextInvoiceId(requestKind.prefix);
      const request: PaymentRequest = {
        network,
        to: session.address,
        amount: amount.trim(),
        invoice: invoiceId,
        label: label.trim() || requestKind.placeholder,
        kind,
      };
      saveInvoice({
        ...request,
        createdAt: Date.now(),
        status: "unpaid",
      });
      setCreated(request);
      setInvoice(nextInvoiceId(requestKind.prefix));
      setAmount("");
      setLabel("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid amount");
    } finally {
      setCreating(false);
    }
  }

  async function copyUrl(url = payUrl) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Payment link copied");
    } catch {
      toast.error("Could not copy link");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Get paid</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Create one private-payment QR for an invoice, a sale, a donation, or
          the MorokPay Private Drop. Ready keeps the viewing key; the label and
          reference stay off-chain.
        </p>
      </div>
      <TestnetHint />

      {!session ? <ConnectPanel /> : null}

      {presence === "undeployed" ? (
        <Alert>
          <AlertTitle>This Ready is not on Starknet {network} yet</AlertTitle>
          <AlertDescription>
            Your QR will scan, but the pool cannot deliver a private note to an
            address that has never transacted here. Shield once on {network} to
            activate the account, then share the link.
          </AlertDescription>
        </Alert>
      ) : null}

      {presence !== "undeployed" && registration === "unregistered" ? (
        <Alert>
          <AlertTitle>Activate private payments first</AlertTitle>
          <AlertDescription>
            This Ready exists on {network}, but it has no STRK20 viewing key
            registered yet. Shield once in Top up, then return here. That makes
            every contest QR a real, payable private account.
          </AlertDescription>
        </Alert>
      ) : null}

      {session ? (
        <Card>
          <CardHeader>
            <CardTitle>{requestKind.title}</CardTitle>
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
                <FieldLabel>Request type</FieldLabel>
                <ToggleGroup
                  aria-label="Payment request type"
                  variant="outline"
                  value={[kind]}
                  onValueChange={(next) => {
                    const value = next[0] as PaymentKind | undefined;
                    if (value) {
                      setKind(value);
                      setInvoice("");
                      setLabel("");
                    }
                  }}
                  className="flex flex-wrap justify-start"
                >
                  {REQUEST_KINDS.map((entry) => (
                    <ToggleGroupItem key={entry.value} value={entry.value}>
                      {entry.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {kind === "drop" ? (
                  <FieldDescription>
                    Use this for the public contest: connect and activate Ready,
                    generate your QR, then publish it under the contest post.
                  </FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="invoice-amount">Amount (USDC)</FieldLabel>
                <Input
                  id="invoice-amount"
                  inputMode="decimal"
                  value={amount}
                  placeholder={
                    kind === "donation" || kind === "drop"
                      ? "Optional"
                      : "12.50"
                  }
                  onChange={(event) => setAmount(event.target.value)}
                />
                {kind === "donation" || kind === "drop" ? (
                  <FieldDescription>
                    Leave empty so the
                    {kind === "drop" ? " organizer" : " supporter"} chooses the
                    amount after scanning.
                  </FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="invoice-label">What is it for</FieldLabel>
                <Input
                  id="invoice-label"
                  value={label}
                  placeholder={requestKind.placeholder}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="invoice-id">Reference</FieldLabel>
                <Input
                  id="invoice-id"
                  value={invoice}
                  placeholder={`${requestKind.prefix}-9K2M`}
                  onChange={(event) => setInvoice(event.target.value)}
                />
                <FieldDescription>
                  Kept in the QR link and your local list; it is not published
                  in the private transfer.
                </FieldDescription>
              </Field>
            </FieldGroup>
            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Could not create invoice</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="border-t">
            <Button
              type="button"
              size="lg"
              className="min-h-10"
              disabled={creating || !canCreate}
              aria-busy={creating}
              onClick={() => {
                void handleCreate();
              }}
            >
              Create private payment QR
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {visibleCreated && payUrl ? (
        <Card>
          <CardHeader>
            <CardTitle>{visibleCreated.label || "Private payment"}</CardTitle>
            <CardDescription>
              {visibleCreated.amount
                ? `${visibleCreated.amount} USDC`
                : visibleCreated.kind === "drop"
                  ? "Organizer chooses reward"
                  : "Supporter chooses amount"}{" "}
              · {visibleCreated.invoice}
              {visibleCreated.network === "sepolia" ? " · Sepolia" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <QrCode
              value={payUrl}
              label={
                visibleCreated.amount
                  ? `Pay ${visibleCreated.amount} USDC, reference ${visibleCreated.invoice}`
                  : visibleCreated.kind === "drop"
                    ? `Private Drop entry, reference ${visibleCreated.invoice}`
                    : `Private donation, reference ${visibleCreated.invoice}`
              }
            />
            <p className="break-all font-mono text-xs text-muted-foreground">
              {payUrl}
            </p>
          </CardContent>
          <CardFooter className="border-t">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-10"
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

      {session && invoices.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="invoices-heading">
          <h2 id="invoices-heading" className="text-xl font-semibold">
            Invoices
          </h2>
          <ul className="flex flex-col gap-2">
            {invoices.map((entry) => (
              <li
                key={`${entry.network}-${entry.invoice}-${entry.createdAt}`}
                className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10"
              >
                <div className="min-w-0">
                  <button
                    type="button"
                    className="block w-full text-left"
                    title="Show the QR again and copy the link"
                    onClick={() => {
                      setCreated(entry);
                      void copyUrl(paymentUrl(window.location.origin, entry));
                    }}
                  >
                    <p className="truncate text-sm font-medium underline-offset-4 hover:underline">
                      {entry.invoice}
                      {entry.label ? ` · ${entry.label}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.amount ? `${entry.amount} USDC` : "Open amount"} ·{" "}
                      {shortenAddress(entry.to)}
                    </p>
                  </button>
                  {entry.settledTx ? (
                    <a
                      href={`${starknet.explorer}/tx/${entry.settledTx}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground underline underline-offset-2"
                    >
                      Settled on-chain
                    </a>
                  ) : null}
                </div>
                {entry.status === "paid" ? (
                  <Badge>Paid</Badge>
                ) : (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void refreshBalances({ private: true })}
                    >
                      Check balance
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => recordMorokSale(entry, session.address)}
                    >
                      Mark paid
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
