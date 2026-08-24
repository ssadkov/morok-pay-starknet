import { describe, expect, it } from "vitest";

import { extractTxHash, formatStrk20Error, isUserRefused } from "./errors";

describe("formatStrk20Error", () => {
  it("explains the Ready Smart Account privacy backend error", () => {
    expect(
      formatStrk20Error(
        new Error("Account not found on the privacy backend"),
        "shield",
      ),
    ).toMatch(/turn off Smart Account.*Standard Account/i);
  });

  it("explains NOT_REGISTERED", () => {
    expect(
      formatStrk20Error(new Error("An error occurred (NOT_REGISTERED)"), "shield"),
    ).toMatch(/not registered in the STRK20 pool/i);
  });

  it("explains USER_REFUSED on balance reads", () => {
    expect(
      formatStrk20Error(new Error("USER_REFUSED_OP"), "balance"),
    ).toMatch(/did not share private balances/i);
  });

  it("turns Ready UNKNOWN_ERROR during shield into privacy guidance", () => {
    expect(
      formatStrk20Error(
        new Error("An error occurred (UNKNOWN_ERROR)"),
        "shield",
      ),
    ).toMatch(/one-time privacy activation/i);
  });

  it("turns Ready UNKNOWN_ERROR during balance reads into activation guidance", () => {
    expect(
      formatStrk20Error(
        new Error("An error occurred (UNKNOWN_ERROR)"),
        "balance",
      ),
    ).toMatch(/deploy and activate/i);
  });
});

describe("extractTxHash", () => {
  const hash =
    "0x014d2aba19ece00931b5434dc48720197cf21691a12c664a3abdd7d3983954a2";

  it("reads transaction_hash from a wallet response", () => {
    expect(extractTxHash({ transaction_hash: hash })).toBe(hash);
  });

  it("pulls a hash out of an error message", () => {
    expect(extractTxHash(new Error(`timeout ${hash}`))).toBe(hash);
  });
});

describe("isUserRefused", () => {
  it("detects Ready refusals", () => {
    expect(isUserRefused(new Error("USER_REFUSED_OP"))).toBe(true);
    expect(isUserRefused(new Error("timeout"))).toBe(false);
  });
});
