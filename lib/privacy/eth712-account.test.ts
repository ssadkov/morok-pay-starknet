import { describe, expect, it, vi } from "vitest";
import { hashMessage } from "viem";

import {
  deployEth712AccountCall,
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

  it("serializes the EVM signature exactly as the factory ABI expects", () => {
    expect(
      deployEth712AccountCall({
        factoryAddress: "0x123",
        evmAddress: "0x456",
        signature:
          "0x00000000000000000000000000000000112233445566778899aabbccddeeff0000000000000000000000000000000000ffeeddccbbaa998877665544332211001c",
      }),
    ).toEqual({
      contractAddress:
        "0x0000000000000000000000000000000000000000000000000000000000000123",
      entrypoint: "deploy_account",
      calldata: [
        "0x456",
        "0x112233445566778899aabbccddeeff00",
        "0x0",
        "0xffeeddccbbaa99887766554433221100",
        "0x0",
        "0x1",
      ],
    });
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
