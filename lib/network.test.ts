import { describe, expect, it } from "vitest";

import { defaultAppNetwork, parseAppNetwork } from "./network";

describe("parseAppNetwork", () => {
  it("defaults when empty", () => {
    expect(parseAppNetwork(null, "mainnet")).toBe("mainnet");
    expect(parseAppNetwork("", "sepolia")).toBe("sepolia");
  });

  it("accepts mainnet and sepolia", () => {
    expect(parseAppNetwork("mainnet")).toBe("mainnet");
    expect(parseAppNetwork("sepolia")).toBe("sepolia");
  });

  it("rejects unknown values", () => {
    expect(() => parseAppNetwork("devnet")).toThrow("Invalid network");
  });
});

describe("defaultAppNetwork", () => {
  it("starts on Sepolia unless env forces mainnet", () => {
    expect(defaultAppNetwork()).toBe(
      process.env.NEXT_PUBLIC_STARKNET_NETWORK === "mainnet"
        ? "mainnet"
        : "sepolia",
    );
  });
});
