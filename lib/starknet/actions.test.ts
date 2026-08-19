import { describe, expect, it } from "vitest";

import { toCalldataFelt } from "./actions";

const WALLET_FELT_RE = /^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$/;

describe("toCalldataFelt", () => {
  it("keeps zero as 0x0", () => {
    expect(toCalldataFelt("0x0")).toBe("0x0");
    expect(toCalldataFelt(BigInt(0))).toBe("0x0");
  });

  it("strips the leading zeros Ready rejects in invoke calldata", () => {
    const padded =
      "0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343";
    const felt = toCalldataFelt(padded);
    expect(felt.startsWith("0x0")).toBe(false);
    expect(WALLET_FELT_RE.test(felt)).toBe(true);
    expect(BigInt(felt)).toBe(BigInt(padded));
  });

  it("leaves an already-canonical felt alone", () => {
    expect(toCalldataFelt("0x1")).toBe("0x1");
  });
});
