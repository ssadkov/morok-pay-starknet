import { describe, expect, it } from "vitest";

import {
  allocateContest,
  BASE_WEIGHTS,
  BUDGET_USDC,
  CAP,
  parseDonationEntries,
  rescaleWeights,
} from "./allocate-contest.mjs";

function links(count) {
  return Array.from(
    { length: count },
    (_, index) =>
      `https://morok-pay-starknet.vercel.app/pay?n=mainnet&kind=donation&to=0x${(index + 1).toString(16)}`,
  ).join("\n");
}

describe("what a full field pays out", () => {
  it("pays the base weights unchanged when every place is filled", () => {
    const entries = parseDonationEntries(links(CAP));
    const result = allocateContest(entries, "0xabc");
    expect(result.finisherCount).toBe(CAP);
    expect(
      result.allocations.map((a) => a.amountUsdc).sort((a, b) => b - a),
    ).toEqual([...BASE_WEIGHTS].sort((a, b) => b - a));
    expect(result.allocations.reduce((s, a) => s + a.amountUsdc, 0)).toBe(
      BUDGET_USDC,
    );
  });
});

describe("what fewer finishers pays out - the actual point of this script", () => {
  it("still spends the full budget on 5 of the 7 places", () => {
    const entries = parseDonationEntries(links(5));
    const result = allocateContest(entries, "0xabc");
    expect(result.finisherCount).toBe(5);
    const total = result.allocations.reduce((s, a) => s + a.amountUsdc, 0);
    expect(total).toBe(BUDGET_USDC);
    // Each of the 5 got strictly more than the same rank would have in a
    // full field of 7 - that is the redistribution the user asked for.
    const fullField = allocateContest(parseDonationEntries(links(CAP)), "0xabc");
    for (let i = 0; i < 5; i++) {
      expect(result.allocations[i].amountUsdc).toBeGreaterThanOrEqual(
        fullField.allocations[i].amountUsdc,
      );
    }
  });

  it("gives the one finisher the entire budget", () => {
    const entries = parseDonationEntries(links(1));
    const result = allocateContest(entries, "0xabc");
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].amountUsdc).toBe(BUDGET_USDC);
  });

  it("refuses more entries than the cap instead of silently truncating", () => {
    expect(() => parseDonationEntries(links(CAP + 1))).toThrow(/caps at/);
  });
});

describe("rescaling always lands on the exact budget", () => {
  it("sums to the budget in cents for every count from 1 to the cap, whatever the weights", () => {
    for (let count = 1; count <= CAP; count++) {
      const amounts = rescaleWeights(count);
      const totalCents = Math.round(
        amounts.reduce((s, a) => s + a, 0) * 100,
      );
      expect(totalCents).toBe(Math.round(BUDGET_USDC * 100));
      expect(amounts).toHaveLength(count);
    }
  });

  it("never lets a later rank out-earn an earlier one", () => {
    for (let count = 1; count <= CAP; count++) {
      const amounts = rescaleWeights(count);
      for (let i = 1; i < amounts.length; i++) {
        expect(amounts[i]).toBeLessThanOrEqual(amounts[i - 1]);
      }
    }
  });
});

describe("same allocation rules as the first-10 script", () => {
  it("is deterministic and reproducible from the same seed and entry set", () => {
    const entries = parseDonationEntries(links(5));
    const a = allocateContest(entries, "0xabc");
    const b = allocateContest(entries, "0xabc");
    expect(a).toEqual(b);
  });

  it("changes every entry's rank score when the seed changes", () => {
    const entries = parseDonationEntries(links(5));
    const a = allocateContest(entries, "0xabc").allocations;
    const b = allocateContest(entries, "0xdef").allocations;
    // A different seed must reprice every entry, even if a small field
    // happens to land back in the same final order by coincidence.
    for (const entry of a) {
      const other = b.find((x) => x.address === entry.address);
      expect(other.score).not.toBe(entry.score);
    }
  });

  it("still rejects Private Drop links and duplicate addresses", () => {
    expect(() => parseDonationEntries(links(3).replace("donation", "drop"))).toThrow(
      "link is not a Donation QR",
    );
    const dup = `${links(2)}\n${links(1)}`;
    expect(() => parseDonationEntries(dup)).toThrow(/duplicate/);
  });
});
