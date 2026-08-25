import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import { OWNERSHIP_MESSAGE } from "./eth712-account";
import {
  parseWholeStrk,
  verifyOwnershipRequest,
} from "./onboarding-server";

describe("MetaMask onboarding server validation", () => {
  it("accepts only an ownership signature from the claimed EVM account", async () => {
    const account = privateKeyToAccount(
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    );
    const signature = await account.signMessage({ message: OWNERSHIP_MESSAGE });
    await expect(
      verifyOwnershipRequest({ evmAddress: account.address, signature }),
    ).resolves.toMatchObject({ evmAddress: account.address });
    await expect(
      verifyOwnershipRequest({
        evmAddress: "0x0000000000000000000000000000000000000002",
        signature,
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it("parses a bounded whole-STRK deployment threshold", () => {
    expect(parseWholeStrk(undefined, 7n)).toBe(7n);
    expect(parseWholeStrk("10", 0n)).toBe(10n * 10n ** 18n);
    expect(() => parseWholeStrk("1.5", 0n)).toThrow(/configuration/i);
    expect(() => parseWholeStrk("1001", 0n)).toThrow(/configuration/i);
  });
});
