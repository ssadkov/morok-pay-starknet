import { hash, shortString } from "starknet";

/** Matches contracts/src/commitment.cairo `INVOICE_TAG`. */
export const INVOICE_TAG = shortString.encodeShortString("MOROK_INVOICE:V1");

export function computeInvoiceCommitment(
  merchantSecret: bigint | number | string,
  invoiceSeq: bigint | number | string,
) {
  return hash.computePoseidonHashOnElements([
    INVOICE_TAG,
    merchantSecret.toString(),
    invoiceSeq.toString(),
  ]);
}
