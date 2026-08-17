import { CallData } from "starknet";
import { describe, expect, it } from "vitest";

import { hexToByteArray, starkAddressToBytes32 } from "./bytes";

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
