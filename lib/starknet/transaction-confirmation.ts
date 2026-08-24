export const WALLET_SUBMISSION_TIMEOUT_MS = 90_000;
export const RECEIPT_CONFIRMATION_TIMEOUT_MS = 90_000;

export type BoundedResult<T> =
  | { status: "settled"; value: T }
  | { status: "timed_out" };

export async function bounded<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<BoundedResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ status: "settled", value }) as const),
      new Promise<{ status: "timed_out" }>((resolve) => {
        timer = setTimeout(() => resolve({ status: "timed_out" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type ReceiptState = "pending" | "confirmed" | "failed";

export function receiptState(receipt: unknown): ReceiptState {
  if (!receipt || typeof receipt !== "object") return "pending";
  const value = receipt as Record<string, unknown> & {
    isSuccess?: () => boolean;
    isReverted?: () => boolean;
  };
  if (typeof value.isReverted === "function" && value.isReverted()) return "failed";
  if (typeof value.isSuccess === "function" && value.isSuccess()) return "confirmed";

  const execution = String(value.execution_status ?? "").toUpperCase();
  if (execution === "REVERTED") return "failed";
  if (execution === "SUCCEEDED") return "confirmed";
  return "pending";
}

export async function pollTransactionReceipt(args: {
  read: () => Promise<unknown>;
  timeoutMs?: number;
  intervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}): Promise<ReceiptState> {
  const timeoutMs = args.timeoutMs ?? RECEIPT_CONFIRMATION_TIMEOUT_MS;
  const intervalMs = args.intervalMs ?? 2_000;
  const wait =
    args.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = args.now ?? Date.now;
  const deadline = now() + timeoutMs;

  do {
    try {
      const remaining = Math.max(1, deadline - now());
      const result = await bounded(args.read(), remaining);
      if (result.status === "settled") {
        const state = receiptState(result.value);
        if (state !== "pending") return state;
      }
    } catch {
      // A relayed hash can be invisible to this RPC for a short period.
    }
    if (now() >= deadline) break;
    await wait(Math.min(intervalMs, Math.max(0, deadline - now())));
  } while (now() <= deadline);

  return "pending";
}
