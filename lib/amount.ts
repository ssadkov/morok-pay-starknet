export function parseTokenAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter an amount");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Amount must be a number");
  }
  const [whole = "0", frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded || "0");
}

export function parseUsdc(value: string): bigint {
  return parseTokenAmount(value, 6);
}
