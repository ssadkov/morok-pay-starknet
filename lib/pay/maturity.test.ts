import { describe, expect, it } from "vitest";

import { ACTIVITY_STORAGE_KEY } from "./activity";
import {
  formatRemaining,
  latestUsdcShieldAt,
  NOTE_MATURITY_MS,
  usdcNoteReady,
} from "./maturity";

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

describe("latestUsdcShieldAt", () => {
  function withActivity<T>(rows: unknown[], run: () => T): T {
    const store = new Map<string, string>([
      [ACTIVITY_STORAGE_KEY, JSON.stringify(rows)],
    ]);
    const globals = globalThis as { window?: unknown };
    const original = globals.window;
    globals.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
      dispatchEvent: () => true,
    };
    try {
      return run();
    } finally {
      globals.window = original;
    }
  }

  it("ignores a pay row that is still pending", () => {
    /* Donate writes its row before the wallet is even asked. Counting it
       restarted the countdown on click, so the app looked like it had reset
       its own wait while the donation was running. */
    withActivity(
      [
        {
          id: "pay",
          network: "sepolia",
          kind: "pay",
          source: "morok",
          status: "pending",
          amount: "2",
          address: "0x1",
          at: 9_000,
        },
        {
          id: "shield",
          network: "sepolia",
          kind: "shield",
          source: "morok",
          amount: "10",
          address: "0x1",
          at: 1_000,
        },
      ],
      () => expect(latestUsdcShieldAt("sepolia", "0x1")).toBe(1_000),
    );
  });

  it("counts a pay row once it settles", () => {
    withActivity(
      [
        {
          id: "pay",
          network: "sepolia",
          kind: "pay",
          source: "morok",
          status: "confirmed",
          amount: "2",
          address: "0x1",
          at: 9_000,
        },
      ],
      () => expect(latestUsdcShieldAt("sepolia", "0x1")).toBe(9_000),
    );
  });
});
