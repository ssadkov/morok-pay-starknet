import { describe, expect, it } from "vitest";

import { allocateFirst10, parseDonationEntries } from "./allocate-first-10.mjs";

function links(kind = "donation") {
  return Array.from(
    { length: 10 },
    (_, index) =>
      `https://morok-pay-starknet.vercel.app/pay?n=mainnet&kind=${kind}&to=0x${(index + 1).toString(16)}`,
  ).join("\n");
}

describe("First 10 allocation", () => {
  it("accepts ten current open-amount Donation QR links", () => {
    const entries = parseDonationEntries(links());
    const result = allocateFirst10(entries, "0xabc");

    expect(result.eligibleCount).toBe(10);
    expect(result.budgetUsdc).toBe(30);
    expect(result.allocations.map((entry) => entry.amountUsdc).sort((a, b) => b - a)).toEqual([
      10, 3, 3, 2, 2, 2, 2, 2, 2, 2,
    ]);
  });

  it("rejects legacy Private Drop links", () => {
    expect(() => parseDonationEntries(links("drop"))).toThrow(
      "link is not a Donation QR",
    );
  });

  it("rejects a fixed-amount donation link", () => {
    expect(() => parseDonationEntries(`${links()}&amount=1`)).toThrow(
      "Donation QR must have an open amount",
    );
  });
});
