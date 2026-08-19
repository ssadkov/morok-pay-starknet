"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
import { parseUsdc } from "@/lib/amount";
import { recordMorokSale } from "@/lib/pay/activity";
import {
  computeInvoiceCommitment,
  isCommitment,
  readMerchantSecret,
} from "@/lib/pay/commitment";
import {
  nextInvoiceId,
  readInvoices,
  saveInvoice,
  subscribeInvoices,
  type MerchantInvoice,
} from "@/lib/pay/invoices";
import { paymentUrl, type PaymentRequest } from "@/lib/pay/request";
import { findInvoiceSettlement } from "@/lib/starknet/invoice-events";
import { createProvider, formatUsdc } from "@/lib/starknet/status";
import { shortenAddress } from "@/lib/format";

const EMPTY_INVOICES: MerchantInvoice[] = [];

function useInvoices(network: ReturnType<typeof useNetwork>["network"]) {
  return useSyncExternalStore(
    subscribeInvoices,
    () => readInvoices(network),
    () => EMPTY_INVOICES,
  );
}

export function SellPanel() {
  const { network, starknet } = useNetwork();
  const { session, privateRaw, balancesLoading } = useTreasury();
  const invoices = useInvoices(network);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [invoice, setInvoice] = useState("");
  const [created, setCreated] = useState<PaymentRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Without MorokInvoices on this network the till falls back to Mark paid.
  const settlesOnChain = Boolean(starknet.invoices);

  const payUrl = useMemo(() => {
    if (!created || typeof window === "undefined") return "";
    return paymentUrl(window.location.origin, created);
  }, [created]);

  useEffect(() => {
    setCreated(null);
    setError(null);
  }, [network]);

  async function handleCreate() {
    if (!session) return;
    setError(null);
    setCreating(true);
    try {
      parseUsdc(amount);
      const invoiceId = invoice.trim() || nextInvoiceId();
      const request: PaymentRequest = {
        network,
        to: session.address,
        amount: amount.trim(),
        invoice: invoiceId,
        label: label.trim(),
        commitment: computeInvoiceCommitment({
          secret: readMerchantSecret(),
          invoice: invoiceId,
        }),
      };
      let fromBlock: number | undefined;
      try {
        fromBlock = await createProvider(network).getBlockNumber();
      } catch {
        // Without a height the settlement scan falls back to a recent window.
      }
      saveInvoice({
        ...request,
        createdAt: Date.now(),
        status: "unpaid",
        fromBlock,
      });
      setCreated(request);
      setInvoice(nextInvoiceId());
      setAmount("");
      setLabel("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid amount");
    } finally {
      setCreating(false);
    }
  }

  // MorokInvoices logs a commitment hash when the pool settles a payment, so
  // the till can mark a sale without another share-private-balances prompt.
  useEffect(() => {
    const address = session?.address;
    if (!address || !settlesOnChain) return;
    const pending = invoices.filter(
      (entry) => entry.status === "unpaid" && isCommitment(entry.commitment),
    );
    if (pending.length === 0) return;

    let cancelled = false;
    const scan = async () => {
      for (const entry of pending) {
        if (cancelled) return;
        try {
          const settlement = await findInvoiceSettlement({
            network,
            commitment: entry.commitment as string,
            fromBlock: entry.fromBlock,
          });
          if (settlement && !cancelled) {
            recordMorokSale(entry, address, settlement.txHash);
          }
        } catch {
          // Keep polling; the RPC may be rate limiting.
        }
      }
    };

    void scan();
    const timer = window.setInterval(() => void scan(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session?.address, network, invoices, settlesOnChain]);

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
          {!settlesOnChain
            ? "Your Ready address is the till. Create an invoice, show the QR, then mark the sale paid once the payment lands — no viewing key leaves Ready."
            : network === "sepolia"
              ? "Sepolia till: create a test invoice and show the QR. It flips to paid on its own once the pool settles the invoice hash on-chain. Pool fee for the buyer is 2 STRK."
              : "Your Ready address is the till. Create an invoice, show the QR, and it flips to paid once the pool settles the invoice hash on-chain — no viewing key leaves Ready."}
        </p>
      </div>
      <TestnetHint />

      {!session ? <ConnectPanel /> : null}

      {session ? (
        <Card>
          <CardHeader>
            <CardTitle>New invoice</CardTitle>
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
                <FieldLabel htmlFor="invoice-amount">Amount (USDC)</FieldLabel>
                <Input
                  id="invoice-amount"
                  inputMode="decimal"
                  value={amount}
                  placeholder="12.50"
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="invoice-label">What is it for</FieldLabel>
                <Input
                  id="invoice-label"
                  value={label}
                  placeholder="Coffee"
                  onChange={(event) => setLabel(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="invoice-id">Account number</FieldLabel>
                <Input
                  id="invoice-id"
                  value={invoice}
                  placeholder="INV-9K2M"
                  onChange={(event) => setInvoice(event.target.value)}
                />
                <FieldDescription>
                  Printed on the QR so you can match the sale later.
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
              disabled={creating}
              aria-busy={creating}
              onClick={() => {
                void handleCreate();
              }}
            >
              Create QR invoice
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {created && payUrl ? (
        <Card>
          <CardHeader>
            <CardTitle>{created.label || "Invoice"}</CardTitle>
            <CardDescription>
              {created.amount} USDC · {created.invoice}
              {created.network === "sepolia" ? " · Sepolia" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <QrCode
              value={payUrl}
              label={`Pay ${created.amount} USDC, invoice ${created.invoice}`}
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
                      {entry.amount} USDC · {shortenAddress(entry.to)}
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
                  ) : entry.status === "unpaid" &&
                    settlesOnChain &&
                    isCommitment(entry.commitment) ? (
                    <p className="text-xs text-muted-foreground">
                      Watching the chain for this invoice
                    </p>
                  ) : null}
                </div>
                {entry.status === "paid" ? (
                  <Badge>Paid</Badge>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => recordMorokSale(entry, session.address)}
                  >
                    Mark paid
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
