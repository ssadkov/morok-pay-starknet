import { describe, expect, it } from "vitest";

import { formatRemaining, NOTE_MATURITY_MS, usdcNoteReady } from "./maturity";

describe("usdcNoteReady", () => {
  it("is not ready without private USDC", () => {
    expect(
      usdcNoteReady({
        privateUsdc: BigInt(0),
        lastShieldAt: null,
        now: 1_000,
      }),
    ).toEqual({ ready: false, remainingMs: 0 });
  });

  it("skips the wait when USDC was already in the pool", () => {
    expect(
      usdcNoteReady({
        privateUsdc: BigInt(1_000_000),
        lastShieldAt: null,
        now: 1_000,
      }),
    ).toEqual({ ready: true, remainingMs: 0 });
  });

  it("waits after a fresh shield", () => {
    const now = NOTE_MATURITY_MS;
    expect(
      usdcNoteReady({
        privateUsdc: BigInt(1_000_000),
        lastShieldAt: 1_000,
        now,
      }),
    ).toEqual({
      ready: false,
      remainingMs: NOTE_MATURITY_MS - (now - 1_000),
    });
  });

  it("clears once the maturity window has passed", () => {
    expect(
      usdcNoteReady({
        privateUsdc: BigInt(1_000_000),
        lastShieldAt: 1,
        now: 1 + NOTE_MATURITY_MS,
      }),
    ).toEqual({ ready: true, remainingMs: 0 });
  });
});

describe("formatRemaining", () => {
  it("renders m:ss", () => {
    expect(formatRemaining(90_000)).toBe("1:30");
    expect(formatRemaining(5_000)).toBe("0:05");
  });
});
