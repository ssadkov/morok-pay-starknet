import { describe, expect, it } from "vitest";

import { jitterUnshieldAmount } from "./jitter";

const usdc = (value: number) => BigInt(Math.round(value * 1e6));

/** Walks the unit interval so the properties are checked across the range. */
function sweep(steps = 200) {
  let index = 0;
  return () => (index++ % steps) / steps;
}

describe("jitterUnshieldAmount", () => {
  it("never withdraws more than is there", () => {
    const random = sweep();
    for (const balance of [usdc(1), usdc(5), usdc(12.34), usdc(1000)]) {
      for (let i = 0; i < 200; i++) {
        expect(jitterUnshieldAmount(balance, random)).toBeLessThanOrEqual(
          balance,
        );
      }
    }
  });

  it("always leaves a remainder behind", () => {
    /* A balance that goes to zero says the total was exactly this. */
    const random = sweep();
    for (let i = 0; i < 200; i++) {
      expect(jitterUnshieldAmount(usdc(50), random)).toBeLessThan(usdc(50));
    }
  });

  it("stays within five percent of the balance", () => {
    const random = sweep();
    for (let i = 0; i < 200; i++) {
      expect(jitterUnshieldAmount(usdc(50), random)).toBeGreaterThanOrEqual(
        usdc(47.5),
      );
    }
  });

  it("does not land on a whole dollar", () => {
    const random = sweep();
    for (let i = 0; i < 500; i++) {
      const amount = jitterUnshieldAmount(usdc(200), random);
      expect(amount % BigInt(1_000_000)).not.toBe(BigInt(0));
    }
  });

  it("is expressible in whole cents", () => {
    const random = sweep();
    for (let i = 0; i < 200; i++) {
      expect(jitterUnshieldAmount(usdc(37.5), random) % BigInt(10_000)).toBe(
        BigInt(0),
      );
    }
  });

  it("gives different answers on different rolls", () => {
    const seen = new Set<string>();
    const random = sweep();
    for (let i = 0; i < 100; i++) {
      seen.add(jitterUnshieldAmount(usdc(500), random).toString());
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it("behaves like Max when there is nothing to slice", () => {
    /* Under twenty cents a slice is dust, not cover. Pretending otherwise
       would cost the user money for no privacy at all. */
    expect(jitterUnshieldAmount(usdc(0.15), () => 0.5)).toBe(usdc(0.15));
    expect(jitterUnshieldAmount(BigInt(0), () => 0.5)).toBe(BigInt(0));
  });

  it("truncates sub-cent dust rather than rounding up past the balance", () => {
    expect(jitterUnshieldAmount(BigInt(159_999), () => 0.5)).toBe(usdc(0.15));
  });
});
