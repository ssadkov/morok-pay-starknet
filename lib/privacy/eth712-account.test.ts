import { describe, expect, it, vi } from "vitest";
import { hashMessage } from "viem";

import {
  EXPECTED_OWNERSHIP_MESSAGE_HASH,
  inspectEth712Account,
  OWNERSHIP_MESSAGE,
} from "./eth712-account";

describe("Eth712Account factory", () => {
  it("uses the exact ownership message hash expected by the account contract", () => {
    expect(hashMessage(OWNERSHIP_MESSAGE)).toBe(
      EXPECTED_OWNERSHIP_MESSAGE_HASH,
    );
  });

  it("resolves an undeployed deterministic account without guessing class state", async () => {
    const expected = "0x123";
    const reader = {
      callContract: vi.fn(async ({ entrypoint }: { entrypoint: string }) => {
        if (entrypoint === "get_expected_account_address") return [expected];
        if (entrypoint === "get_account") return ["0x0"];
        if (entrypoint === "account_class_hash") return ["0x456"];
        throw new Error(`unexpected entrypoint ${entrypoint}`);
      }),
      getClassHashAt: vi.fn(async () => "0x789"),
    };

    await expect(
      inspectEth712Account(
        "0x1111111111111111111111111111111111111111",
        reader,
      ),
    ).resolves.toMatchObject({
      starknetAddress:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      configuredAccountClassHash: "0x456",
      factoryClassHash: "0x789",
      deployed: false,
      deployedClassHash: null,
    });
    expect(reader.getClassHashAt).toHaveBeenCalledTimes(1);
  });

  it("verifies the class hash of an existing deterministic account", async () => {
    const expected = "0x123";
    const reader = {
      callContract: vi.fn(async ({ entrypoint }: { entrypoint: string }) => {
        if (entrypoint === "get_expected_account_address") return [expected];
        if (entrypoint === "get_account") return [expected];
        return ["0x456"];
      }),
      getClassHashAt: vi
        .fn<(address: string) => Promise<string>>()
        .mockResolvedValueOnce("0x789")
        .mockResolvedValueOnce("0x456"),
    };

    await expect(
      inspectEth712Account(
        "0x1111111111111111111111111111111111111111",
        reader,
      ),
    ).resolves.toMatchObject({
      deployed: true,
      deployedClassHash: "0x456",
    });
  });
});
