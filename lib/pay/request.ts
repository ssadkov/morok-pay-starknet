import { parseAppNetwork, type AppNetwork } from "@/lib/network";

export type PaymentKind = "invoice" | "sale" | "donation";

export type PaymentRequest = {
  network: AppNetwork;
  to: string;
  amount: string;
  invoice: string;
  label: string;
  kind?: PaymentKind;
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;
const PAYMENT_KINDS = new Set<PaymentKind>([
  "invoice",
  "sale",
  "donation",
]);

function paymentKind(value: string): PaymentKind {
  // Keep previously shared Drop links payable after consolidating the
  // open-amount flow into Donation.
  if (value === "drop") return "donation";
  return PAYMENT_KINDS.has(value as PaymentKind)
    ? (value as PaymentKind)
    : "invoice";
}

function firstParam(
  params: URLSearchParams,
  key: string,
): string {
  return params.get(key)?.trim() ?? "";
}

export function parsePaymentRequest(
  params: URLSearchParams,
  fallbackNetwork: AppNetwork,
): PaymentRequest | null {
  const to = firstParam(params, "to");
  const amount = firstParam(params, "amount");
  const kind = paymentKind(firstParam(params, "kind"));
  if (!ADDRESS_RE.test(to)) return null;
  if (!amount && kind !== "donation") return null;
  if (amount && !/^\d+(\.\d+)?$/.test(amount)) return null;

  return {
    network: parseAppNetwork(params.get("n"), fallbackNetwork),
    to,
    amount,
    invoice: firstParam(params, "inv").slice(0, 64),
    label: firstParam(params, "label").slice(0, 80),
    kind,
  };
}

export function serializePaymentRequest(request: PaymentRequest): URLSearchParams {
  const params = new URLSearchParams();
  params.set("n", request.network);
  params.set("to", request.to);
  if (request.amount) params.set("amount", request.amount);
  if (request.invoice) params.set("inv", request.invoice);
  if (request.label) params.set("label", request.label);
  if (request.kind && request.kind !== "invoice") {
    params.set("kind", request.kind);
  }
  return params;
}

export function paymentPath(request: PaymentRequest): string {
  return `/pay?${serializePaymentRequest(request).toString()}`;
}

export function paymentUrl(origin: string, request: PaymentRequest): string {
  return `${origin.replace(/\/$/, "")}${paymentPath(request)}`;
}

export function parsePaymentLink(
  value: string,
  fallbackNetwork: AppNetwork,
): PaymentRequest | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes("://")
      ? new URL(trimmed)
      : new URL(trimmed, "https://morokpay.local");
    return parsePaymentRequest(url.searchParams, fallbackNetwork);
  } catch {
    return null;
  }
}
