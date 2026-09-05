import { describe, expect, it } from "vitest";

import {
  claimV2Url,
  commitmentFromSeed,
  ESCROW_V2_TAG,
  isSeed,
  parseClaimV2Request,
  randomSeed,
  seedEvmAddress,
} from "./escrow-v2";
import { computeEscrowCommitment } from "./escrow";

const SEED = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("seeds", () => {
  it("generates a 32-byte hex key", () => {
    const seed = randomSeed();
    expect(isSeed(seed)).toBe(true);
    expect(seed).toHaveLength(66);
  });

  it("rejects a V1 secret, which is a byte shorter", () => {
    /* V1's randomSecret is 31 bytes, to stay inside a felt. Reading one as a
       seed would silently derive an entry that was never created. */
    expect(isSeed("0x" + "ab".repeat(31))).toBe(false);
  });

  it("rejects zero and junk", () => {
    expect(isSeed(`0x${"0".repeat(64)}`)).toBe(false);
    expect(isSeed("nope")).toBe(false);
    expect(isSeed(undefined)).toBe(false);
  });

  it("controls one EVM address, the same one every time", () => {
    const address = seedEvmAddress(SEED);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(seedEvmAddress(SEED)).toBe(address);
  });
});

describe("commitmentFromSeed", () => {
  it("is stable for a seed and different across seeds", () => {
    const other = `0x${"11".repeat(32)}` as const;
    expect(commitmentFromSeed(SEED)).toBe(commitmentFromSeed(SEED));
    expect(commitmentFromSeed(SEED)).not.toBe(commitmentFromSeed(other));
  });

  it("does not collide with V1's commitment for the same bytes", () => {
    /* The two contracts key their storage the same way, so a value that
       hashed alike would point one product at the other's entry. */
    expect(commitmentFromSeed(SEED)).not.toBe(computeEscrowCommitment(SEED));
  });

  it("uses the V2 tag", () => {
    expect(ESCROW_V2_TAG).toBe("MOROK_ESCROW:V2");
  });
});

describe("claim links", () => {
  it("round-trips through a URL", () => {
    const url = claimV2Url("https://morok.example/", {
      network: "sepolia",
      seed: SEED,
      amount: "1.5",
    });
    const parsed = parseClaimV2Request(
      new URLSearchParams(new URL(url).search),
      "mainnet",
    );
    expect(parsed).toEqual({ network: "sepolia", seed: SEED, amount: "1.5" });
  });

  it("ignores a V1 link entirely", () => {
    /* `s` is V1's parameter. Falling back to it here would hand a V1 secret to
       a contract that authorises by owner and would find nothing. */
    const parsed = parseClaimV2Request(
      new URLSearchParams(`n=sepolia&s=${SEED}`),
      "sepolia",
    );
    expect(parsed).toBeNull();
  });

  it("drops an amount that is not a plain number", () => {
    const parsed = parseClaimV2Request(
      new URLSearchParams(`n=sepolia&k=${SEED}&amount=1e9`),
      "sepolia",
    );
    expect(parsed?.amount).toBeUndefined();
  });

  it("falls back to the current network when the link omits one", () => {
    const parsed = parseClaimV2Request(new URLSearchParams(`k=${SEED}`), "mainnet");
    expect(parsed?.network).toBe("mainnet");
  });
});
