"use client";

import { toast } from "sonner";
import { CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * One shape for every "a transaction happened" toast in the app.
 *
 * These used to be built by hand at each call site - a description string
 * holding the raw hash, an action button to an explorer. Sonner's default
 * duration (4s) was gone before a reader had found the hash, let alone
 * copied it, and nothing offered a copy at all: the hash sat there as text
 * to select by hand, mid-transaction, on mobile. Centralizing it here is
 * what makes "hold it longer, add a copy button" a one-file change instead
 * of a sweep through fifteen call sites the next time it needs to move.
 */

/** Long enough to read, tap through to the explorer, or copy the hash. */
export const TX_TOAST_DURATION_MS = 15_000;

function shortenHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

function TxHashLine({ hash, note }: { hash: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {note ? <span>{note}</span> : null}
      <div className="flex items-center gap-1 font-mono text-xs">
        <span>{shortenHash(hash)}</span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Copy transaction hash"
          onClick={(event) => {
            // The toast itself is often clickable to dismiss; a copy tap
            // must not also close it out from under the reader.
            event.stopPropagation();
            void navigator.clipboard
              .writeText(hash)
              .then(() => toast.success("Transaction hash copied", { duration: 2_000 }))
              .catch(() => toast.error("Could not copy the hash"));
          }}
        >
          <CopyIcon />
        </Button>
      </div>
    </div>
  );
}

/**
 * Announces a transaction: a title, its hash (shown short, copyable), an
 * optional extra line, and a link out to whichever explorer this chain uses.
 */
export function txToast(args: {
  title: string;
  txHash: string;
  /** Full URL to the transaction on its explorer. */
  explorerUrl: string;
  /** "Voyager" for Starknet, "Basescan" for Base. */
  explorerLabel: string;
  /** A line above the hash, e.g. who paid the fee. */
  note?: string;
}) {
  toast.success(args.title, {
    duration: TX_TOAST_DURATION_MS,
    description: <TxHashLine hash={args.txHash} note={args.note} />,
    action: {
      label: args.explorerLabel,
      onClick: () =>
        window.open(args.explorerUrl, "_blank", "noopener,noreferrer"),
    },
  });
}
