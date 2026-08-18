import { hash } from "starknet";

import type { AppNetwork } from "@/lib/network";

import { starknetOf } from "./constants";
import { createProvider } from "./status";

export const INVOICE_SETTLED_SELECTOR =
  hash.getSelectorFromName("InvoiceSettled");

/** Scan window when an invoice predates on-chain settlement bookkeeping. */
const FALLBACK_BLOCK_SPAN = 500;

export type InvoiceSettlement = {
  txHash: string;
  blockNumber: number;
};

/**
 * Look for `MorokInvoices.InvoiceSettled` with this commitment. The commitment
 * is a key, so the node filters and nothing about the payment leaks here.
 */
export async function findInvoiceSettlement(args: {
  network: AppNetwork;
  commitment: string;
  fromBlock?: number;
}): Promise<InvoiceSettlement | null> {
  const address = starknetOf(args.network).invoices;
  if (!address) return null;

  const provider = createProvider(args.network);
  const fromBlock =
    args.fromBlock ??
    Math.max(0, (await provider.getBlockNumber()) - FALLBACK_BLOCK_SPAN);

  const page = await provider.getEvents({
    address,
    keys: [[INVOICE_SETTLED_SELECTOR], [args.commitment]],
    from_block: { block_number: fromBlock },
    to_block: "latest",
    chunk_size: 10,
  });

  const event = page.events?.[0];
  if (!event?.transaction_hash) return null;
  return {
    txHash: event.transaction_hash,
    blockNumber: Number(event.block_number ?? fromBlock),
  };
}

export async function currentBlock(
  network: AppNetwork,
): Promise<number | undefined> {
  try {
    return await createProvider(network).getBlockNumber();
  } catch {
    return undefined;
  }
}

/**
 * Ready sometimes never hands the transaction hash back to the page. The
 * settlement event proves the payment landed, so watch for it as well.
 */
export async function waitForInvoiceSettlement(args: {
  network: AppNetwork;
  commitment: string;
  fromBlock?: number;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<InvoiceSettlement | null> {
  const deadline = Date.now() + (args.timeoutMs ?? 180_000);
  const interval = args.intervalMs ?? 5_000;
  while (Date.now() < deadline) {
    try {
      const settlement = await findInvoiceSettlement(args);
      if (settlement) return settlement;
    } catch {
      // Keep polling; the RPC may be rate limiting.
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return null;
}
