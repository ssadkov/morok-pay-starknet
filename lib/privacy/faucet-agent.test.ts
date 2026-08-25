import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { hasLeadingZeroBits, solvePowChallenge } from "./faucet-agent";

describe("Starknet faucet proof of work", () => {
  it("checks non-byte-aligned leading zero bits", () => {
    expect(hasLeadingZeroBits(Uint8Array.from([0x00, 0x07]), 13)).toBe(true);
    expect(hasLeadingZeroBits(Uint8Array.from([0x00, 0x08]), 13)).toBe(false);
    expect(hasLeadingZeroBits(Uint8Array.from([0x00, 0x00]), 16)).toBe(true);
    expect(hasLeadingZeroBits(Uint8Array.from([0x00, 0x01]), 16)).toBe(false);
  });

  it("finds a decimal nonce for the exact prefix plus nonce format", () => {
    const prefix = "challenge:salt:0x123:";
    const nonce = solvePowChallenge({
      prefix,
      difficulty: 8,
      deadline: Date.now() + 2_000,
    });
    const digest = createHash("sha256").update(`${prefix}${nonce}`).digest();
    expect(hasLeadingZeroBits(digest, 8)).toBe(true);
  });
});
