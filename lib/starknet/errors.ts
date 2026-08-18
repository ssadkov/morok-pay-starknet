function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

const TX_HASH_RE = /0x[0-9a-fA-F]{49,}/;

export function extractTxHash(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.match(TX_HASH_RE)?.[0];
  }
  if (value instanceof Error) {
    return extractTxHash(value.message);
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["transaction_hash", "transactionHash", "txHash", "hash"]) {
    const field = record[key];
    if (typeof field === "string" && TX_HASH_RE.test(field)) return field;
  }
  return (
    extractTxHash(record.error) ??
    extractTxHash(record.data) ??
    extractTxHash(record.cause)
  );
}

export function isUserRefused(error: unknown) {
  return /USER_REFUSED/i.test(errorText(error));
}

export function formatStrk20Error(
  error: unknown,
  action: "shield" | "payout" | "pay" | "balance",
): string {
  const message = errorText(error);
  if (/NOT_REGISTERED/i.test(message)) {
    return "This Ready account is not registered in the STRK20 pool yet. Top up and shield once so Ready can register you, then pay.";
  }
  if (/INSUFFICIENT_PRIVATE_BALANCE/i.test(message)) {
    return action === "pay"
      ? "Private USDC is too low for this payment. Top up and shield first."
      : "Private balance is too low for this payout.";
  }
  if (/PRIVACY_LEAK/i.test(message)) {
    return "Ready blocked this action because it would leak privacy.";
  }
  if (/USER_REFUSED/i.test(message) && action === "balance") {
    return "Ready did not share private balances. Click refresh and approve once.";
  }
  if (action === "balance") {
    return message || "Ready could not read the private balance";
  }
  if (action === "pay") return message || "Payment failed";
  return message || (action === "shield" ? "Shield failed" : "Payout failed");
}
