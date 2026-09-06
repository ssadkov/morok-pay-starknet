import type { Hex } from "viem";

import type { AppNetwork } from "@/lib/network";
import { isSeed } from "@/lib/pay/escrow-v2";

export const ESCROW_V2_BACKUP_KEY = "morokpay.escrow-v2-backups";
export const ESCROW_V2_BACKUP_CHANGE = "morokpay-escrow-v2-backups";

/** What the sender must keep to reclaim after expiry. Never put this in the claim link. */
export type EscrowV2Backup = {
  version: 1;
  network: AppNetwork;
  escrow: string;
  commitment: string;
  refundSeed: Hex;
  /** Unix seconds. Zero means never refundable. */
  expiresAt: number;
  amount: string;
  amountRaw: string;
  createdAt: number;
  txHash?: string;
  claimSeed?: Hex;
  /** Present for invoice-to-MetaMask parks; omitted for bearer links. */
  recipientEvm?: string;
};

function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ESCROW_V2_BACKUP_CHANGE));
}

function readAll(): EscrowV2Backup[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ESCROW_V2_BACKUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBackup);
  } catch {
    return [];
  }
}

function writeAll(items: EscrowV2Backup[]) {
  window.localStorage.setItem(ESCROW_V2_BACKUP_KEY, JSON.stringify(items));
  notify();
}

export function isBackup(value: unknown): value is EscrowV2Backup {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.version === 1 &&
    (item.network === "sepolia" || item.network === "mainnet") &&
    typeof item.escrow === "string" &&
    typeof item.commitment === "string" &&
    isSeed(typeof item.refundSeed === "string" ? item.refundSeed : undefined) &&
    typeof item.expiresAt === "number" &&
    typeof item.amount === "string" &&
    typeof item.amountRaw === "string" &&
    typeof item.createdAt === "number"
  );
}

export function listEscrowV2Backups(network?: AppNetwork): EscrowV2Backup[] {
  const items = readAll().sort((a, b) => b.createdAt - a.createdAt);
  return network ? items.filter((item) => item.network === network) : items;
}

export function saveEscrowV2Backup(backup: EscrowV2Backup) {
  const items = readAll().filter(
    (item) =>
      !(item.network === backup.network && item.commitment === backup.commitment),
  );
  items.unshift(backup);
  writeAll(items);
}

export function updateEscrowV2Backup(
  network: AppNetwork,
  commitment: string,
  patch: Partial<Pick<EscrowV2Backup, "txHash" | "claimSeed">>,
) {
  const items = readAll().map((item) =>
    item.network === network && item.commitment === commitment
      ? { ...item, ...patch }
      : item,
  );
  writeAll(items);
}

export function removeEscrowV2Backup(network: AppNetwork, commitment: string) {
  writeAll(
    readAll().filter(
      (item) => !(item.network === network && item.commitment === commitment),
    ),
  );
}

export function importEscrowV2Backup(raw: string): EscrowV2Backup {
  const parsed = JSON.parse(raw) as unknown;
  const candidate = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!isBackup(candidate)) throw new Error("This is not a MorokPay recovery backup");
  saveEscrowV2Backup(candidate);
  return candidate;
}

export function backupDownloadName(backup: EscrowV2Backup): string {
  return `morok-escrow-recovery-${backup.network}-${backup.commitment.slice(0, 10)}.json`;
}

export function downloadEscrowV2Backup(backup: EscrowV2Backup) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = backupDownloadName(backup);
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Default claim window before the sender can reclaim privately. */
export const DEFAULT_ESCROW_V2_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
