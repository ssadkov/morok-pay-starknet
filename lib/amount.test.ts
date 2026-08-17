import { describe, expect, it } from "vitest";

import { parseUsdc } from "./amount";

describe("parseUsdc", () => {
  it("parses whole and fractional USDC", () => {
    expect(parseUsdc("12")).toBe(BigInt(12_000_000));
    expect(parseUsdc("12.5")).toBe(BigInt(12_500_000));
    expect(parseUsdc("0.01")).toBe(BigInt(10_000));
  });

  it("rejects empty or invalid input", () => {
    expect(() => parseUsdc("")).toThrow(/amount/i);
    expect(() => parseUsdc("abc")).toThrow(/number/i);
  });
});
