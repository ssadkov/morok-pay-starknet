import { describe, expect, it, vi } from "vitest";

import { bounded, pollTransactionReceipt, receiptState } from "./transaction-confirmation";

describe("bounded", () => {
  it("returns a confirmed wallet response", async () => {
    await expect(bounded(Promise.resolve({ transaction_hash: "0x1" }), 10)).resolves.toEqual({
      status: "settled",
      value: { transaction_hash: "0x1" },
    });
  });

  it("releases the caller when the wallet promise never settles", async () => {
    vi.useFakeTimers();
    try {
      const result = bounded(new Promise<never>(() => undefined), 90_000);
      await vi.advanceTimersByTimeAsync(90_000);
      await expect(result).resolves.toEqual({ status: "timed_out" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a rejected wallet request", async () => {
    await expect(bounded(Promise.reject(new Error("USER_REFUSED")), 10)).rejects.toThrow(
      "USER_REFUSED",
    );
  });
});

describe("pollTransactionReceipt", () => {
  it("tolerates delayed RPC visibility", async () => {
    let now = 0;
    const read = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("TXN_HASH_NOT_FOUND"))
      .mockResolvedValueOnce({ execution_status: "SUCCEEDED" });
    await expect(
      pollTransactionReceipt({
        read,
        timeoutMs: 10,
        intervalMs: 1,
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
        },
      }),
    ).resolves.toBe("confirmed");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("returns pending after a bounded timeout", async () => {
    let now = 0;
    await expect(
      pollTransactionReceipt({
        read: async () => {
          throw new Error("not visible");
        },
        timeoutMs: 2,
        intervalMs: 1,
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
        },
      }),
    ).resolves.toBe("pending");
  });

  it("bounds an RPC request that itself never settles", async () => {
    vi.useFakeTimers();
    try {
      const result = pollTransactionReceipt({
        read: () => new Promise<never>(() => undefined),
        timeoutMs: 10,
      });
      await vi.advanceTimersByTimeAsync(10);
      await expect(result).resolves.toBe("pending");
    } finally {
      vi.useRealTimers();
    }
  });

  it("distinguishes failed and successful receipts", () => {
    expect(receiptState({ execution_status: "REVERTED" })).toBe("failed");
    expect(receiptState({ isSuccess: () => true })).toBe("confirmed");
  });
});
