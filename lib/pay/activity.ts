import { parseUsdc } from "@/lib/amount";
import type { AppNetwork } from "@/lib/network";

import {
  markInvoicePaid,
  readInvoices,
  type MerchantInvoice,
} from "./invoices";

export type ActivityKind = "pay" | "receive" | "shield" | "unshield";
export type ActivitySource = "morok" | "private";
export type ActivityStatus = "pending" | "confirmed" | "failed";

export type ActivityItem = {
  id: string;
  network: AppNetwork;
  kind: ActivityKind;
  source?: ActivitySource;
  status?: ActivityStatus;
  amount: string;
  amountRaw?: string;
  invoice?: string;
  label?: string;
  counterparty?: string;
  address?: string;
  txHash?: string;
  at: number;
};

export const ACTIVITY_STORAGE_KEY = "morokpay.activity";
export const ACTIVITY_CHANGE_EVENT = "morokpay-activity";
/** Ignore Ready note-scan jitter below 0.10 USDC (6 decimals). */
export const PRIVATE_DELTA_DUST_RAW = BigInt(100_000);

function newId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function readAll(): ActivityItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActivityItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items: ActivityItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    ACTIVITY_STORAGE_KEY,
    JSON.stringify(items.slice(0, 200)),
  );
  window.dispatchEvent(new Event(ACTIVITY_CHANGE_EVENT));
}

let activityCache: { key: string; value: ActivityItem[] } | null = null;

export function readActivity(
  network: AppNetwork,
  address?: string,
): ActivityItem[] {
  const value = readAll()
    .filter((item) => {
      if (item.network !== network) return false;
      if (!address || !item.address) return true;
      return sameAddress(item.address, address);
    })
    .sort((left, right) => right.at - left.at);
  const key = `${network}:${address ?? ""}:${JSON.stringify(value)}`;
  if (activityCache?.key === key) return activityCache.value;
  activityCache = { key, value };
  return value;
}

export function recordActivity(
  item: Omit<ActivityItem, "id" | "at" | "source"> & {
    at?: number;
    id?: string;
    source?: ActivitySource;
  },
) {
  const next: ActivityItem = {
    ...item,
    source: item.source ?? "morok",
    id: item.id ?? newId(),
    at: item.at ?? Date.now(),
  };
  writeAll([next, ...readAll()]);
  return next;
}

export function updateActivity(id: string, patch: Partial<ActivityItem>) {
  const items = readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const next = { ...items[index], ...patch, id };
  items[index] = next;
  writeAll(items);
  return next;
}

export function removeActivity(id: string) {
  writeAll(readAll().filter((item) => item.id !== id));
}

export function subscribeActivity(onStoreChange: () => void) {
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(ACTIVITY_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(ACTIVITY_CHANGE_EVENT, handler);
  };
}

export function sameAddress(left: string, right: string) {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return left.toLowerCase() === right.toLowerCase();
  }
}

function itemAmountRaw(item: ActivityItem): bigint | null {
  if (item.amountRaw) {
    try {
      return BigInt(item.amountRaw);
    } catch {
      return null;
    }
  }
  try {
    return parseUsdc(item.amount);
  } catch {
    return null;
  }
}

function formatUsdcRaw(raw: bigint): string {
  const whole = raw / BigInt(1_000_000);
  const frac = raw % BigInt(1_000_000);
  if (frac === BigInt(0)) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

export function hasRecentKind(
  network: AppNetwork,
  address: string,
  kind: ActivityKind,
  amountRaw: bigint,
  withinMs = 90_000,
) {
  const now = Date.now();
  return readActivity(network, address).some((item) => {
    if (item.kind !== kind) return false;
    if (now - item.at >= withinMs) return false;
    return itemAmountRaw(item) === amountRaw;
  });
}

export function findIncomingInvoice(
  invoices: MerchantInvoice[],
  args: { merchant: string; amountRaw: bigint },
): MerchantInvoice | null {
  const unpaid = invoices
    .filter(
      (invoice) =>
        invoice.status === "unpaid" && sameAddress(invoice.to, args.merchant),
    )
    .sort((left, right) => left.createdAt - right.createdAt);

  for (const invoice of unpaid) {
    try {
      if (parseUsdc(invoice.amount) === args.amountRaw) return invoice;
    } catch {
      // Skip malformed invoice amounts.
    }
  }
  return null;
}

export type PrivateDelta =
  | { kind: "none" }
  | { kind: "sale"; invoice: MerchantInvoice }
  | { kind: "receive"; amountRaw: bigint }
  | { kind: "pay"; amountRaw: bigint };

export function classifyPrivateDelta(args: {
  delta: bigint;
  invoices: MerchantInvoice[];
  merchant: string;
  recentShield: boolean;
  recentPay: boolean;
  recentUnshield: boolean;
}): PrivateDelta {
  if (args.delta === BigInt(0)) return { kind: "none" };
  const abs = args.delta < BigInt(0) ? -args.delta : args.delta;
  // Ready's note scan jitters by a few cents between prompts; ignore that noise.
  if (abs < PRIVATE_DELTA_DUST_RAW) return { kind: "none" };
  if (args.delta > BigInt(0)) {
    if (args.recentShield) return { kind: "none" };
    const invoice = findIncomingInvoice(args.invoices, {
      merchant: args.merchant,
      amountRaw: args.delta,
    });
    if (invoice) return { kind: "sale", invoice };
    return { kind: "receive", amountRaw: args.delta };
  }
  if (args.recentPay || args.recentUnshield) return { kind: "none" };
  return { kind: "pay", amountRaw: abs };
}

export function hasInvoiceActivity(
  network: AppNetwork,
  address: string,
  invoice: string,
) {
  return readActivity(network, address).some(
    (item) => item.invoice === invoice && item.kind === "receive",
  );
}

export function recordMorokSale(invoice: MerchantInvoice, address: string) {
  markInvoicePaid(invoice.network, invoice.invoice);
  if (hasInvoiceActivity(invoice.network, address, invoice.invoice)) return;
  let amountRaw: string | undefined;
  try {
    amountRaw = parseUsdc(invoice.amount).toString();
  } catch {
    amountRaw = undefined;
  }
  return recordActivity({
    network: invoice.network,
    kind: "receive",
    source: "morok",
    amount: invoice.amount,
    amountRaw,
    invoice: invoice.invoice,
    label: invoice.label,
    counterparty: invoice.to,
    address,
  });
}

export function reconcilePrivateBalance(args: {
  network: AppNetwork;
  address: string;
  previousRaw: bigint;
  nextRaw: bigint;
}) {
  const delta = args.nextRaw - args.previousRaw;
  const classified = classifyPrivateDelta({
    delta,
    invoices: readInvoices(args.network),
    merchant: args.address,
    recentShield: hasRecentKind(
      args.network,
      args.address,
      "shield",
      delta > BigInt(0) ? delta : BigInt(0),
    ),
    recentPay: hasRecentKind(
      args.network,
      args.address,
      "pay",
      delta < BigInt(0) ? -delta : BigInt(0),
    ),
    recentUnshield: hasRecentKind(
      args.network,
      args.address,
      "unshield",
      delta < BigInt(0) ? -delta : BigInt(0),
    ),
  });

  if (classified.kind === "sale") {
    return recordMorokSale(classified.invoice, args.address);
  }
  if (classified.kind === "receive") {
    return recordActivity({
      network: args.network,
      kind: "receive",
      source: "private",
      amount: formatUsdcRaw(classified.amountRaw),
      amountRaw: classified.amountRaw.toString(),
      address: args.address,
    });
  }
  if (classified.kind === "pay") {
    return recordActivity({
      network: args.network,
      kind: "pay",
      source: "private",
      amount: formatUsdcRaw(classified.amountRaw),
      amountRaw: classified.amountRaw.toString(),
      address: args.address,
    });
  }
  return null;
}
