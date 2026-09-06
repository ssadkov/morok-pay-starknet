import { describe, expect, it } from "vitest";

import { ESCROW_SELF_CHANNEL_DUST, sameFeltAddress } from "./escrow-self-channel";

describe("escrow self-channel helpers", () => {
  it("compares felt addresses ignoring padding", () => {
    expect(sameFeltAddress("0x1", "0x01")).toBe(true);
    expect(sameFeltAddress("0x2", "0x3")).toBe(false);
  });

  it("uses a dust amount far below the 1 USDC escrow minimum", () => {
    expect(ESCROW_SELF_CHANNEL_DUST).toBe(1n);
    expect(ESCROW_SELF_CHANNEL_DUST).toBeLessThan(1_000_000n);
  });
});
