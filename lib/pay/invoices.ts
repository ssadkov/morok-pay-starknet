import type { AppNetwork } from "@/lib/network";
import type { PaymentRequest } from "./request";

export type InvoiceStatus = "unpaid" | "paid";

export type MerchantInvoice = PaymentRequest & {
  createdAt: number;
  status: InvoiceStatus;
  /** Local confirmation time. Not cryptographic payment proof. */
  paidAt?: number;
  /** Local merchant workflow state. */
  fulfilledAt?: number;
  /** Block height when the invoice was created, so event scans stay short. */
  fromBlock?: number;
  /** Legacy display-only transaction hash; never treated as payment proof. */
  settledTx?: string;
};

export const INVOICE_STORAGE_KEY = "morokpay.invoices";
export const INVOICE_CHANGE_EVENT = "morokpay-invoices";

function randomId() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes)
    .map((byte) => byte.toString(36).toUpperCase().padStart(2, "0"))
    .join("")
    .slice(0, 4);
  return `INV-${token}`;
}

export function nextInvoiceId(prefix = "SALE"): string {
  return randomId().replace("INV", prefix.replace(/[^A-Z0-9]/gi, "").toUpperCase() || "INV");
}

function readAll(): MerchantInvoice[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(INVOICE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MerchantInvoice[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(invoices: MerchantInvoice[]) {
  window.localStorage.setItem(INVOICE_STORAGE_KEY, JSON.stringify(invoices));
  window.dispatchEvent(new Event(INVOICE_CHANGE_EVENT));
}

let invoiceCache: { key: string; value: MerchantInvoice[] } | null = null;

export function readInvoices(network: AppNetwork): MerchantInvoice[] {
  const value = readAll()
    .filter((invoice) => invoice.network === network)
    .sort((left, right) => right.createdAt - left.createdAt);
  const key = `${network}:${JSON.stringify(value)}`;
  if (invoiceCache?.key === key) return invoiceCache.value;
  invoiceCache = { key, value };
  return value;
}

export function saveInvoice(invoice: MerchantInvoice) {
  const rest = readAll().filter(
    (entry) =>
      !(entry.invoice === invoice.invoice && entry.network === invoice.network),
  );
  writeAll([invoice, ...rest]);
}

export function markInvoicePaid(
  network: AppNetwork,
  invoice: string,
  settledTx?: string,
) {
  writeAll(
    readAll().map((entry) =>
      entry.network === network && entry.invoice === invoice
        ? {
            ...entry,
            status: "paid",
            paidAt: entry.paidAt ?? Date.now(),
            settledTx: settledTx ?? entry.settledTx,
          }
        : entry,
    ),
  );
}

export function setSaleFulfilled(
  network: AppNetwork,
  sale: string,
  fulfilled: boolean,
) {
  writeAll(
    readAll().map((entry) =>
      entry.network === network && entry.invoice === sale
        ? { ...entry, fulfilledAt: fulfilled ? Date.now() : undefined }
        : entry,
    ),
  );
}

export function subscribeInvoices(onStoreChange: () => void) {
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(INVOICE_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(INVOICE_CHANGE_EVENT, handler);
  };
}
