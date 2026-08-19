import { describe, expect, it } from "vitest";

import {
  claimPath,
  computeEscrowCommitment,
  isSecret,
  parseClaimRequest,
} from "./escrow";

describe("computeEscrowCommitment", () => {
  it("matches the Cairo test vector", () => {
    expect(BigInt(computeEscrowCommitment("0xb"))).toBe(
      BigInt(
        "0x0251f0242a4e3747bcbb19fd743f50ad614497e1c6223d97f0e21e5edc2cd9ce",
      ),
    );
  });

  it("changes with the secret", () => {
    expect(computeEscrowCommitment("0xb")).not.toBe(computeEscrowCommitment("0xc"));
  });
});

describe("parseClaimRequest", () => {
  it("round-trips a claim link", () => {
    const path = claimPath({
      network: "sepolia",
      secret: "0xb",
      amount: "0.5",
    });
    const params = new URLSearchParams(path.split("?")[1]);
    expect(parseClaimRequest(params, "mainnet")).toEqual({
      network: "sepolia",
      secret: "0xb",
      amount: "0.5",
    });
  });

  it("drops a missing secret", () => {
    expect(parseClaimRequest(new URLSearchParams("n=sepolia"), "sepolia")).toBe(
      null,
    );
  });
});

describe("isSecret", () => {
  it("rejects junk and zero", () => {
    expect(isSecret(undefined)).toBe(false);
    expect(isSecret("0x0")).toBe(false);
    expect(isSecret("nope")).toBe(false);
  });
});
