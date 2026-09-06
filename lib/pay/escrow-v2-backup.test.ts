import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  backupDownloadName,
  importEscrowV2Backup,
  isBackup,
  listEscrowV2Backups,
  removeEscrowV2Backup,
  saveEscrowV2Backup,
  type EscrowV2Backup,
} from "./escrow-v2-backup";

const SAMPLE: EscrowV2Backup = {
  version: 1,
  network: "sepolia",
  escrow: "0x3cdf",
  commitment: "0xabc",
  refundSeed: `0x${"11".repeat(32)}`,
  expiresAt: 1_800_000_000,
  amount: "1.00",
  amountRaw: "1000000",
  createdAt: 1_700_000_000,
};

describe("escrow v2 backup storage", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        clear: () => store.clear(),
      },
      dispatchEvent: () => true,
    });
  });

  it("round-trips through localStorage", () => {
    saveEscrowV2Backup(SAMPLE);
    expect(listEscrowV2Backups("sepolia")).toEqual([SAMPLE]);
    removeEscrowV2Backup("sepolia", SAMPLE.commitment);
    expect(listEscrowV2Backups("sepolia")).toEqual([]);
  });

  it("imports a JSON backup and rejects junk", () => {
    const imported = importEscrowV2Backup(JSON.stringify(SAMPLE));
    expect(imported.commitment).toBe(SAMPLE.commitment);
    expect(() => importEscrowV2Backup("{}")).toThrow(/recovery backup/);
    expect(isBackup({ version: 2 })).toBe(false);
  });

  it("names the recovery download from the commitment", () => {
    expect(backupDownloadName(SAMPLE)).toContain(SAMPLE.commitment.slice(0, 10));
  });
});
