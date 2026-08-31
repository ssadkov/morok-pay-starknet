import { describe, expect, it } from "vitest";

import {
  ONBOARDING_MIN_USDC,
  ONBOARDING_SUGGESTED_USDC,
  ONBOARDING_SWAP_USDC,
  bridgeDeliversAtLeast,
} from "./onboarding-limits";

describe("onboarding USDC limits", () => {
  it("lets the suggested amount survive the bridge fee", () => {
    /* The bug this file exists for: bridging the suggested two dollars
       delivered 1.99, and a requirement of two rejected it. */
    expect(bridgeDeliversAtLeast(ONBOARDING_SUGGESTED_USDC)).toBeGreaterThanOrEqual(
      ONBOARDING_MIN_USDC,
    );
  });

  it("requires enough to actually buy the activation STRK", () => {
    expect(ONBOARDING_MIN_USDC).toBeGreaterThanOrEqual(ONBOARDING_SWAP_USDC);
  });

  it("suggests more than it requires", () => {
    expect(ONBOARDING_SUGGESTED_USDC).toBeGreaterThan(ONBOARDING_MIN_USDC);
  });

  it("charges the bridge fee it is told to expect", () => {
    // 10 bps, with a one-cent floor: two dollars pays the floor.
    expect(bridgeDeliversAtLeast(BigInt(2_000_000))).toBe(BigInt(1_990_000));
  });
});
