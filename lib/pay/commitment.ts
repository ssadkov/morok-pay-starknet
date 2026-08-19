import { hash, shortString } from "starknet";

/** Domain tag, mirrors `INVOICE_TAG` in contracts/src/commitment.cairo. */
export const INVOICE_TAG = "MOROK_INVOICE:V1";
export const MERCHANT_SECRET_STORAGE_KEY = "morokpay.merchant-secret";

const FELT_RE = /^0x[0-9a-fA-F]{1,64}$/;

function randomFelt(): string {
  // 31 bytes always fits under the Starknet prime.
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Per-browser secret. Without it anyone could rebuild a commitment from the
 * public invoice number and link an on-chain settlement to a merchant.
 */
export function readMerchantSecret(): string {
  if (typeof window === "undefined") return randomFelt();
  const stored = window.localStorage.getItem(MERCHANT_SECRET_STORAGE_KEY);
  if (stored && FELT_RE.test(stored)) return stored;
  const next = randomFelt();
  window.localStorage.setItem(MERCHANT_SECRET_STORAGE_KEY, next);
  return next;
}

function feltsFromString(value: string): string[] {
  const bytes = new TextEncoder().encode(value);
  const felts: string[] = [];
  for (let index = 0; index < bytes.length; index += 31) {
    const chunk = bytes.slice(index, index + 31);
    felts.push(
      `0x${Array.from(chunk, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
    );
  }
  return felts.length > 0 ? felts : ["0x0"];
}

/** Invoice numbers are free text, so fold them into a single felt. */
export function invoiceSeqFelt(invoice: string): string {
  const felts = feltsFromString(invoice.trim());
  return felts.length === 1 ? felts[0] : hash.computePoseidonHashOnElements(felts);
}

export function commitmentFromFelts(secret: string, seq: string): string {
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString(INVOICE_TAG),
    secret,
    seq,
  ]);
}

export function computeInvoiceCommitment(args: {
  secret: string;
  invoice: string;
}): string {
  return commitmentFromFelts(args.secret, invoiceSeqFelt(args.invoice));
}

export function isCommitment(value: string | undefined): value is string {
  return typeof value === "string" && FELT_RE.test(value);
}
