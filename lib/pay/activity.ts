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
  /** Other party on older records. Prefer `from` / `to`. */
  counterparty?: string;
  from?: string;
  to?: string;
  address?: string;
  txHash?: string;
  /** Private balance immediately before a wallet submission. */
  balanceBeforeRaw?: string;
  /** A confirmed row may be inferred from a sufficient private-balance decrease. */
  confirmation?: "wallet" | "receipt" | "balance";
  at: number;
};

/** Wallets on a row so the till shows where a donation went. Incoming `from` is often missing: STRK20 hides the sender. */
export function activityParties(item: ActivityItem): {
  from?: string;
  to?: string;
} {
  if (item.from || item.to) {
    return { from: item.from, to: item.to };
  }
  if (item.kind === "pay") {
    return { from: item.address, to: item.counterparty };
  }
  if (item.kind === "receive") {
    const from =
      item.counterparty &&
      item.address &&
      sameAddress(item.counterparty, item.address)
        ? undefined
        : item.counterparty;
    return { from, to: item.address };
  }
  return { from: item.address, to: item.address };
}

export const ACTIVITY_STORAGE_KEY = "morokpay.activity";
export const ACTIVITY_CHANGE_EVENT = "morokpay-activity";
export const PRIVATE_BALANCE_SNAPSHOT_KEY = "morokpay.private-balance-snapshots";
/** Ignore Ready note-scan jitter below 0.10 USDC (6 decimals). */
export const PRIVATE_DELTA_DUST_RAW = BigInt(100_000);

export type PrivateBalanceSnapshot = {
  balanceRaw: string;
  at: number;
};

function privateSnapshotId(network: AppNetwork, address: string) {
  try {
    return `${network}:0x${BigInt(address).toString(16)}`;
  } catch {
    return `${network}:${address.toLowerCase()}`;
  }
}

function readPrivateSnapshots(): Record<string, PrivateBalanceSnapshot> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PRIVATE_BALANCE_SNAPSHOT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PrivateBalanceSnapshot>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function readPrivateBalanceSnapshot(
  network: AppNetwork,
  address: string,
): bigint | null {
  const snapshot = readPrivateSnapshots()[privateSnapshotId(network, address)];
  if (!snapshot || !/^\d+$/.test(snapshot.balanceRaw)) return null;
  try {
    return BigInt(snapshot.balanceRaw);
  } catch {
    return null;
  }
}

export function writePrivateBalanceSnapshot(
  network: AppNetwork,
  address: string,
  balanceRaw: bigint,
) {
  if (typeof window === "undefined" || balanceRaw < BigInt(0)) return;
  const snapshots = readPrivateSnapshots();
  snapshots[privateSnapshotId(network, address)] = {
    balanceRaw: balanceRaw.toString(),
    at: Date.now(),
  };
  window.localStorage.setItem(
    PRIVATE_BALANCE_SNAPSHOT_KEY,
    JSON.stringify(snapshots),
  );
}

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
      // A payment Ready never accepted is not history; the UI shows the error.
      if (item.status === "failed") return false;
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

export function findPendingActivity(args: {
  network: AppNetwork;
  address: string;
  kind: "pay" | "unshield";
  to?: string;
  amountRaw?: bigint;
}) {
  return readAll()
    .filter(
      (item) =>
        item.network === args.network &&
        item.status === "pending" &&
        item.kind === args.kind &&
        !!item.address &&
        sameAddress(item.address, args.address) &&
        (!args.to || (!!item.to && sameAddress(item.to, args.to))) &&
        (args.amountRaw === undefined || itemAmountRaw(item) === args.amountRaw),
    )
    .sort((left, right) => right.at - left.at)[0];
}

/**
 * A private balance can update before the relayed hash becomes visible to RPC.
 * Confirm at most the newest pending operation whose full amount has left the balance.
 */
export function reconcilePendingActivityFromBalance(args: {
  network: AppNetwork;
  address: string;
  nextRaw: bigint;
}) {
  const pending = readAll()
    .filter(
      (item) =>
        item.network === args.network &&
        item.status === "pending" &&
        (item.kind === "pay" || item.kind === "unshield") &&
        !!item.address &&
        sameAddress(item.address, args.address) &&
        !!item.balanceBeforeRaw,
    )
    .sort((left, right) => right.at - left.at);

  for (const item of pending) {
    const amount = itemAmountRaw(item);
    if (amount === null) continue;
    try {
      const before = BigInt(item.balanceBeforeRaw!);
      if (before - args.nextRaw >= amount) {
        return updateActivity(item.id, {
          status: "confirmed",
          confirmation: "balance",
        });
      }
    } catch {
      // Ignore malformed legacy activity.
    }
  }
  return null;
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

export function recordMorokSale(
  invoice: MerchantInvoice,
  address: string,
  txHash?: string,
) {
  markInvoicePaid(invoice.network, invoice.invoice, txHash);
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
    status: "confirmed",
    amount: invoice.amount,
    amountRaw,
    invoice: invoice.invoice,
    label: invoice.label,
    to: address,
    address,
    txHash,
  });
}

export function reconcilePrivateBalance(args: {
  network: AppNetwork;
  address: string;
  previousRaw: bigint;
  nextRaw: bigint;
}) {
  const pending = reconcilePendingActivityFromBalance({
    network: args.network,
    address: args.address,
    nextRaw: args.nextRaw,
  });
  if (pending) return pending;
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
      to: args.address,
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
      from: args.address,
      address: args.address,
    });
  }
  return null;
}

/**
 * Restore only a positive net change after the app was closed. It is an
 * inferred balance increase, not a wallet-provided transaction history.
 */
export function reconcilePrivateBalanceAfterReconnect(args: {
  network: AppNetwork;
  address: string;
  previousRaw: bigint;
  nextRaw: bigint;
}) {
  const delta = args.nextRaw - args.previousRaw;
  if (delta < PRIVATE_DELTA_DUST_RAW) return null;

  const invoice = findIncomingInvoice(readInvoices(args.network), {
    merchant: args.address,
    amountRaw: delta,
  });
  if (invoice) return recordMorokSale(invoice, args.address);

  return recordActivity({
    network: args.network,
    kind: "receive",
    source: "private",
    amount: formatUsdcRaw(delta),
    amountRaw: delta.toString(),
    label: "Detected after reconnect",
    to: args.address,
    address: args.address,
  });
}
