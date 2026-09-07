import { isAddress, type Hex } from "viem";

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
  const recoveryOnly = items.map(({ claimSeed: _claimSeed, ...item }) => item);
  window.localStorage.setItem(ESCROW_V2_BACKUP_KEY, JSON.stringify(recoveryOnly));
  notify();
}

export function isBackup(value: unknown): value is EscrowV2Backup {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.version === 1 &&
    (item.network === "sepolia" || item.network === "mainnet") &&
    isFelt(item.escrow) &&
    isFelt(item.commitment) &&
    isSeed(typeof item.refundSeed === "string" ? item.refundSeed : undefined) &&
    Number.isSafeInteger(item.expiresAt) &&
    Number(item.expiresAt) >= 0 &&
    typeof item.amount === "string" && /^\d+(\.\d+)?$/.test(item.amount) &&
    typeof item.amountRaw === "string" && /^[1-9]\d*$/.test(item.amountRaw) &&
    Number.isSafeInteger(item.createdAt) &&
    Number(item.createdAt) > 0 &&
    (item.claimSeed === undefined ||
      isSeed(typeof item.claimSeed === "string" ? item.claimSeed : undefined)) &&
    (item.recipientEvm === undefined ||
      (typeof item.recipientEvm === "string" && isAddress(item.recipientEvm)))
  );
}

function isFelt(value: unknown): value is string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) return false;
  try {
    return BigInt(value) !== 0n;
  } catch {
    return false;
  }
}

export function listEscrowV2Backups(network?: AppNetwork): EscrowV2Backup[] {
  const items = readAll().sort((a, b) => b.createdAt - a.createdAt);
  return network ? items.filter((item) => item.network === network) : items;
}

export function saveEscrowV2Backup(backup: EscrowV2Backup) {
  const items = readAll().filter(
    (item) =>
      !(
        item.network === backup.network &&
        BigInt(item.escrow) === BigInt(backup.escrow) &&
        BigInt(item.commitment) === BigInt(backup.commitment)
      ),
  );
  items.unshift(backup);
  writeAll(items);
}

export function updateEscrowV2Backup(
  network: AppNetwork,
  commitment: string,
  patch: Partial<Pick<EscrowV2Backup, "txHash">>,
  escrow?: string,
) {
  const items = readAll().map((item) =>
    item.network === network &&
    BigInt(item.commitment) === BigInt(commitment) &&
    (!escrow || BigInt(item.escrow) === BigInt(escrow))
      ? { ...item, ...patch }
      : item,
  );
  writeAll(items);
}

export function removeEscrowV2Backup(
  network: AppNetwork,
  commitment: string,
  escrow?: string,
) {
  writeAll(
    readAll().filter(
      (item) =>
        !(
          item.network === network &&
          BigInt(item.commitment) === BigInt(commitment) &&
          (!escrow || BigInt(item.escrow) === BigInt(escrow))
        ),
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

/**
 * What the sender picks from. "Never" is expressible because the contract
 * accepts zero, but it is last and it is not the default: an entry nobody
 * claims and nobody can reclaim is money out of reach for everyone, forever.
 */
export const ESCROW_V2_EXPIRY_CHOICES: { label: string; seconds: number }[] = [
  /* An hour is short enough that the sender can watch the whole lifecycle in
     one sitting, which is what it was added for. It is a real option, not a
     test hook: a link handed over in person is claimed in minutes, and a
     shorter window is a smaller one for a lost link to sit in. It does race,
     though - after the hour the sender may reclaim while the recipient is
     still deciding, and whichever exit lands first wins. */
  { label: "1 hour", seconds: 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: DEFAULT_ESCROW_V2_EXPIRY_SECONDS },
  { label: "30 days", seconds: 30 * 24 * 60 * 60 },
  { label: "Never — you will not be able to reclaim it", seconds: 0 },
];
