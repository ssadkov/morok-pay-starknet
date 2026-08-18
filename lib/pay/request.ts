import { parseAppNetwork, type AppNetwork } from "@/lib/network";

export type PaymentRequest = {
  network: AppNetwork;
  to: string;
  amount: string;
  invoice: string;
  label: string;
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;

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
  if (!ADDRESS_RE.test(to) || !amount) return null;
  if (!/^\d+(\.\d+)?$/.test(amount)) return null;

  return {
    network: parseAppNetwork(params.get("n"), fallbackNetwork),
    to,
    amount,
    invoice: firstParam(params, "inv").slice(0, 64),
    label: firstParam(params, "label").slice(0, 80),
  };
}

export function serializePaymentRequest(request: PaymentRequest): URLSearchParams {
  const params = new URLSearchParams();
  params.set("n", request.network);
  params.set("to", request.to);
  params.set("amount", request.amount);
  if (request.invoice) params.set("inv", request.invoice);
  if (request.label) params.set("label", request.label);
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
