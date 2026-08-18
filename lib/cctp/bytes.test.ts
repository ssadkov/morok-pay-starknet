import { CallData } from "starknet";
import { describe, expect, it } from "vitest";

import {
  depositForBurnCall,
  evmAddressToBytes32,
  hexToByteArray,
  irisTransactionHash,
  starkAddressToBytes32,
} from "./bytes";
import { starknetOf } from "@/lib/starknet/constants";

describe("hexToByteArray", () => {
  it("keeps short payloads in the pending word", () => {
    expect(hexToByteArray("0x010203")).toEqual({
      data: [],
      pending_word: "0x010203",
      pending_word_len: 3,
    });
  });

  it("splits full 31-byte words into data", () => {
    const word = "11".repeat(31);
    expect(hexToByteArray(`0x${word}`)).toEqual({
      data: [`0x${word}`],
      pending_word: "0x0",
      pending_word_len: 0,
    });
  });

  it("compiles to Cairo ByteArray calldata", () => {
    const compiled = CallData.compile({
      message: hexToByteArray("0x010203"),
    });
    expect(compiled[0]).toBe("0");
    expect(compiled.at(-1)).toBe("3");
  });
});

describe("starkAddressToBytes32", () => {
  it("left-pads a Starknet address to 32 bytes", () => {
    expect(
      starkAddressToBytes32(
        "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
      ),
    ).toBe(
      "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    );
  });
});

describe("evmAddressToBytes32", () => {
  it("left-pads a Base address to 32 bytes", () => {
    expect(
      evmAddressToBytes32("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    ).toBe(
      "0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    );
  });
});

describe("irisTransactionHash", () => {
  it("pads a short Starknet hash to 32 bytes", () => {
    expect(irisTransactionHash("0xabc")).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000abc",
    );
  });
});

describe("depositForBurnCall", () => {
  it("encodes amount, domain, recipient, token, caller, fee, and threshold", () => {
    const starknet = starknetOf("mainnet");
    const call = depositForBurnCall({
      amount: BigInt(1_000_000),
      mintRecipient: evmAddressToBytes32(
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      ),
      usdc: starknet.usdc,
      minter: starknet.tokenMessengerMinter,
    });
    expect(call.entrypoint).toBe("deposit_for_burn");
    expect(call.calldata).toHaveLength(11);
  });
});
