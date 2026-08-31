import { describe, expect, it } from "vitest";

import {
  LEGACY_ETH712_ACCOUNT_CLASS_HASH,
  STRK20_ETH712_ACCOUNT_CLASS_HASH,
  type Eth712AccountInspection,
} from "./eth712-account";
import { classifyEvmReadiness } from "./evm-onboarding";

function inspection(
  overrides: Partial<Eth712AccountInspection> = {},
): Eth712AccountInspection {
  return {
    evmAddress: "0x1234",
    starknetAddress: "0xabc",
    factoryAddress: "0xfac",
    factoryClassHash: "0x1",
    configuredAccountClassHash: STRK20_ETH712_ACCOUNT_CLASS_HASH,
    deployed: true,
    deployedClassHash: STRK20_ETH712_ACCOUNT_CLASS_HASH,
    ...overrides,
  };
}

describe("classifyEvmReadiness", () => {
  it("requires deployment before privacy checks", () => {
    expect(
      classifyEvmReadiness(
        inspection({ deployed: false, deployedClassHash: null }),
        null,
      ).status,
    ).toBe("onboarding");
    expect(
      classifyEvmReadiness(
        inspection({ deployed: false, deployedClassHash: null }),
        null,
      ),
    ).toMatchObject({ reason: "undeployed" });
  });

  it("routes a legacy class to the upgrade step", () => {
    expect(
      classifyEvmReadiness(
        inspection({ deployedClassHash: LEGACY_ETH712_ACCOUNT_CLASS_HASH }),
        null,
      ),
    ).toMatchObject({ status: "onboarding", reason: "upgrade" });
  });

  it("lets an unregistered account keep its public half", () => {
    expect(classifyEvmReadiness(inspection(), "unregistered")).toMatchObject({
      status: "partial",
      reason: "unregistered",
    });
  });

  it("accepts only a deployed, compatible, registered account", () => {
    expect(classifyEvmReadiness(inspection(), "registered")).toEqual({
      status: "ready",
      starknetAddress: "0xabc",
    });
  });
});
