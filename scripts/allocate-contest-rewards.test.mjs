import { describe, expect, it } from "vitest";

import {
  allocateContestRewards,
  parseDonationEntries,
} from "./allocate-contest-rewards.mjs";

function donationLinks() {
  return Array.from(
    { length: 10 },
    (_, index) =>
      `https://morok-pay-starknet.vercel.app/pay?n=mainnet&to=0x${(
        index + 1
      ).toString(16)}&kind=donation&inv=TIP-${index + 1}`,
  ).join("\n");
}

describe("contest reward allocation", () => {
  it("allocates exactly 30 USDC across ten donation requests", () => {
    const entries = parseDonationEntries(donationLinks());
    const result = allocateContestRewards(entries, "0x1234");

    expect(result.eligibleCount).toBe(10);
    expect(result.budgetUsdc).toBe(30);
    expect(result.allocations.map((entry) => entry.amountUsdc).sort((a, b) => b - a)).toEqual(
      [10, 3, 3, 2, 2, 2, 2, 2, 2, 2],
    );
  });

  it("rejects a fixed-amount donation", () => {
    expect(() => parseDonationEntries(`${donationLinks()}&amount=10`)).toThrow(
      "reward amount must be organizer-chosen",
    );
  });
});
