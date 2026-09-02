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

  it("orders the field by the rank score it publishes", () => {
    /* The scores changed with the seed and the ordering did not follow them:
       a comparison against the wrong operand left the sort inert, so the
       winner was whoever appeared first in entries.txt. Asserting that scores
       changed was not the same as asserting the ranking used them. */
    const entries = parseDonationEntries(links(5));
    const scores = allocateContest(entries, "0xabc").allocations.map(
      (entry) => entry.score,
    );
    expect(scores).toEqual([...scores].sort());
  });

  it("does not let the order of entries.txt decide the winner", () => {
    const entries = parseDonationEntries(links(5));
    const forwards = allocateContest(entries, "0xabc");
    const backwards = allocateContest([...entries].reverse(), "0xabc");
    expect(backwards.allocations).toEqual(forwards.allocations);
  });

  it("lets the seed reach every place in the field", () => {
    const entries = parseDonationEntries(links(4));
    const winners = new Set();
    for (let i = 1; i <= 40; i++) {
      winners.add(allocateContest(entries, `0x${i.toString(16)}`).allocations[0].address);
    }
    expect(winners.size).toBe(entries.length);
  });

  it("publishes the ranking without naming anybody", () => {
    /* Real-length addresses: the toy ones elsewhere in this file are short
       enough to appear inside any hex string by chance. */
    const entries = parseDonationEntries(
      [1, 2, 3, 4]
        .map(
          (n) =>
            `https://morok-pay-starknet.vercel.app/pay?n=mainnet&kind=donation&to=0x${String(n).repeat(63)}f`,
        )
        .join("\n"),
    );
    const result = allocateContest(entries, "0xabc");
    const posted = JSON.stringify(result.publishable);
    for (const entry of entries) {
      expect(posted).not.toContain(entry.address);
    }
    /* Each entrant still finds their own line by the score they can
       recompute, and reads their prize off it. */
    expect(result.publishable.ranks.map((rank) => rank.score)).toEqual(
      result.allocations.map((entry) => entry.score),
    );
  });

  it("still rejects Private Drop links and duplicate addresses", () => {
    expect(() => parseDonationEntries(links(3).replace("donation", "drop"))).toThrow(
      "link is not a Donation QR",
    );
    const dup = `${links(2)}\n${links(1)}`;
    expect(() => parseDonationEntries(dup)).toThrow(/duplicate/);
  });
});
