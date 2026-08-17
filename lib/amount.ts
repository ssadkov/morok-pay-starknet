const USDC_DECIMALS = 6;

export function parseUsdc(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter an amount");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Amount must be a number");
  }
  const [whole = "0", frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "000000").slice(0, USDC_DECIMALS);
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(fracPadded);
}
