import type { AppNetwork } from "@/lib/network";

export type EscrowClaim = {
  network: AppNetwork;
  secret: string;
  commitment: string;
  amount: string;
  createdAt: number;
  status: "parked" | "claimed";
  txHash?: string;
};

export const CLAIMS_STORAGE_KEY = "morokpay.escrow-claims";
export const CLAIMS_CHANGE_EVENT = "morokpay-escrow-claims";

function readAll(): EscrowClaim[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CLAIMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EscrowClaim[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items: EscrowClaim[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CLAIMS_STORAGE_KEY, JSON.stringify(items.slice(0, 100)));
  window.dispatchEvent(new Event(CLAIMS_CHANGE_EVENT));
}

export function subscribeClaims(onStoreChange: () => void) {
  window.addEventListener(CLAIMS_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(CLAIMS_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function readClaims(network: AppNetwork): EscrowClaim[] {
  return readAll()
    .filter((item) => item.network === network)
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function saveClaim(claim: EscrowClaim) {
  const next = readAll().filter(
    (item) =>
      !(item.network === claim.network && item.commitment === claim.commitment),
  );
  next.unshift(claim);
  writeAll(next);
}
