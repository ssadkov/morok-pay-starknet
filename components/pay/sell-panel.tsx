"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { CopyIcon, PackageCheckIcon, ShoppingBagIcon } from "lucide-react";
import { toast } from "sonner";

import { useNetwork } from "@/components/network-provider";
import { QrCode } from "@/components/pay/qr-code";
import { TestnetHint } from "@/components/pay/testnet-hint";
import { ConnectPanel } from "@/components/treasury/connect-panel";
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
import { shortenAddress } from "@/lib/format";
import { recordMorokSale, sameAddress } from "@/lib/pay/activity";
import {
  nextInvoiceId,
  readInvoices,
  saveInvoice,
  setSaleFulfilled,
  subscribeInvoices,
  type MerchantInvoice,
} from "@/lib/pay/invoices";
import { paymentUrl, type PaymentRequest } from "@/lib/pay/request";
import { summarizeSales } from "@/lib/pay/sales";
import { formatUsdc } from "@/lib/starknet/status";

import { useAccountPresence } from "./use-account-presence";
import { usePoolRegistration } from "./use-pool-registration";

const EMPTY_SALES: MerchantInvoice[] = [];

function useSales(network: ReturnType<typeof useNetwork>["network"]) {
  return useSyncExternalStore(
    subscribeInvoices,
    () => readInvoices(network),
    () => EMPTY_SALES,
  );
}

function saleTime(sale: MerchantInvoice) {
  return new Date(sale.paidAt ?? sale.createdAt).toLocaleString();
}

export function SellPanel() {
  const { network } = useNetwork();
  const { session, privateRaw, balancesLoading, refreshBalances } = useTreasury();
  const storedSales = useSales(network);
  const [price, setPrice] = useState("");
  const [product, setProduct] = useState("");
  const [created, setCreated] = useState<PaymentRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presence = useAccountPresence(session?.address);
  const registration = usePoolRegistration(session?.address);
  const canReceive = presence !== "undeployed" && registration !== "unregistered";
  const visibleCreated = created?.network === network ? created : null;
  const sales = useMemo(
    () =>
      session
        ? storedSales.filter(
            (sale) =>
              sale.kind === "sale" && sameAddress(sale.to, session.address),
          )
        : EMPTY_SALES,
    [session, storedSales],
  );
  const summary = useMemo(() => summarizeSales(sales), [sales]);

  const payUrl = useMemo(() => {
    if (!visibleCreated || typeof window === "undefined") return "";
    return paymentUrl(window.location.origin, visibleCreated);
  }, [visibleCreated]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setError(null);
    setCreating(true);
    try {
      if (parseUsdc(price) <= BigInt(0)) {
        throw new Error("Price must be greater than zero");
      }
      if (!product.trim()) throw new Error("Add a product name");
      if (!canReceive) {
        throw new Error("Activate STRK20 on this network before creating a QR");
      }
      const saleId = nextInvoiceId("SALE");
      const request: PaymentRequest = {
        network,
        to: session.address,
        amount: price.trim(),
        invoice: saleId,
        label: product.trim(),
        kind: "sale",
      };
      saveInvoice({
        ...request,
        createdAt: Date.now(),
        status: "unpaid",
      });
      setCreated(request);
      setPrice("");
      setProduct("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Check the price");
    } finally {
      setCreating(false);
    }
  }

  async function copyUrl(url = payUrl) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Sale link copied");
    } catch {
      toast.error("Could not copy link");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Private checkout
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Sell with a QR</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Add a product and price. The customer pays private USDC in Ready; this
          browser keeps your sales list.
        </p>
      </div>
      <TestnetHint />

      {!session ? <ConnectPanel /> : null}

      {presence === "undeployed" ? (
        <Alert>
          <AlertTitle>This Ready is not on Starknet {network} yet</AlertTitle>
          <AlertDescription>
            Shield once on {network} to activate the account before accepting a
            private payment.
          </AlertDescription>
        </Alert>
      ) : null}

      {presence !== "undeployed" && registration === "unregistered" ? (
        <Alert>
          <AlertTitle>Activate private payments first</AlertTitle>
          <AlertDescription>
            Shield once in Top up, then return here. This registers the Ready
            account so customers can pay it privately.
          </AlertDescription>
        </Alert>
      ) : null}

      {session ? (
        <Card>
          <form onSubmit={handleCreate}>
            <CardHeader>
              <CardTitle>New sale</CardTitle>
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
                  <FieldLabel htmlFor="sale-product">Product</FieldLabel>
                  <Input
                    id="sale-product"
                    value={product}
                    placeholder="Coffee"
                    maxLength={80}
                    autoComplete="off"
                    onChange={(event) => setProduct(event.target.value)}
                    aria-invalid={error === "Add a product name" || undefined}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sale-price">Price (USDC)</FieldLabel>
                  <Input
                    id="sale-price"
                    inputMode="decimal"
                    value={price}
                    placeholder="3.00"
                    maxLength={24}
                    autoComplete="off"
                    onChange={(event) => setPrice(event.target.value)}
                  />
                  <FieldDescription>
                    A unique sale reference is generated automatically.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              {error ? (
                <Alert variant="destructive" className="mt-4">
                  <AlertTitle>Could not create sale</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
            <CardFooter className="border-t">
              <Button
                type="submit"
                size="lg"
                disabled={creating || !canReceive || !product.trim() || !price.trim()}
                aria-busy={creating}
              >
                <ShoppingBagIcon data-icon="inline-start" aria-hidden="true" />
                {creating ? "Creating" : "Create sale QR"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      ) : null}

      {visibleCreated && payUrl ? (
        <Card>
          <CardHeader>
            <CardTitle>{visibleCreated.label}</CardTitle>
            <CardDescription>
              {visibleCreated.amount} USDC · {visibleCreated.invoice}
              {visibleCreated.network === "sepolia" ? " · Sepolia" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <QrCode
              value={payUrl}
              label={`Pay ${visibleCreated.amount} USDC for ${visibleCreated.label}`}
            />
            <p className="break-all font-mono text-xs text-muted-foreground">
              {payUrl}
            </p>
          </CardContent>
          <CardFooter className="border-t">
            <Button type="button" variant="outline" size="lg" onClick={() => void copyUrl()}>
              <CopyIcon data-icon="inline-start" aria-hidden="true" />
              Copy sale link
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {session ? (
        <section className="flex flex-col gap-4" aria-labelledby="sales-heading">
          <div>
            <h2 id="sales-heading" className="text-xl font-semibold">Sales</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Local records for {shortenAddress(session.address)} on {network}.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Paid sales" value={summary.paidCount.toString()} />
            <Metric label="Revenue" value={`${formatUsdc(summary.revenueRaw)} USDC`} />
            <Metric label="Fulfilled" value={`${summary.fulfilledCount} / ${summary.paidCount}`} />
          </div>

          {summary.products.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Products sold</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {summary.products.map((item) => (
                    <li
                      key={item.product}
                      className="flex min-h-12 items-center justify-between gap-4 py-3"
                    >
                      <span className="font-medium">{item.product}</span>
                      <span className="text-right text-sm tabular-nums text-muted-foreground">
                        {item.count} sold · {formatUsdc(item.revenueRaw)} USDC
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {sales.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <ShoppingBagIcon className="size-8 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="font-medium">No sales yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create your first QR above. Paid orders will appear here.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {sales.map((sale) => {
                const paid = sale.status === "paid";
                const fulfilled = Boolean(sale.fulfilledAt);
                return (
                  <li
                    key={`${sale.network}-${sale.invoice}-${sale.createdAt}`}
                    className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        className="min-h-10 min-w-0 text-left focus-visible:rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                        title="Show this sale QR and copy its link"
                        onClick={() => {
                          setCreated(sale);
                          void copyUrl(paymentUrl(window.location.origin, sale));
                        }}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{sale.label || "Unnamed product"}</span>
                          <Badge variant={fulfilled ? "default" : paid ? "secondary" : "outline"}>
                            {fulfilled ? "Fulfilled" : paid ? "Paid" : "Awaiting payment"}
                          </Badge>
                        </span>
                        <span className="mt-1 block text-sm tabular-nums text-muted-foreground">
                          {sale.amount} USDC · {sale.invoice}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {paid ? "Paid" : "Created"} {saleTime(sale)}
                        </span>
                      </button>

                      <div className="flex flex-wrap items-center gap-2">
                        {!paid ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => void refreshBalances({ private: true })}
                            >
                              Check balance
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => recordMorokSale(sale, session.address)}
                            >
                              Confirm paid
                            </Button>
                          </>
                        ) : (
                          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-medium focus-within:ring-3 focus-within:ring-ring/50">
                            <input
                              type="checkbox"
                              checked={fulfilled}
                              className="size-4 accent-primary"
                              onChange={(event) =>
                                setSaleFulfilled(network, sale.invoice, event.target.checked)
                              }
                            />
                            <PackageCheckIcon className="size-4" aria-hidden="true" />
                            {fulfilled ? "Fulfilled" : "Mark fulfilled"}
                          </label>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            Payment and fulfillment status are stored in this browser. Ready
            does not currently share private transaction history with MorokPay.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}
