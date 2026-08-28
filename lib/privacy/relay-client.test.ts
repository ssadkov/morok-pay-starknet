import { describe, expect, it } from "vitest";

import { namesRecipient, normalizeCall } from "./relay-client";

const CREATOR =
  "0x02d76e36009160f6bdb471f2bc6773ad8e356f66091a2f2a88a2ba69931d685a";
const POOL =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

describe("reading a wallet's prepared call", () => {
  it("accepts the Wallet API's snake_case shape", () => {
    expect(
      normalizeCall({
        contract_address: POOL,
        entry_point: "apply_actions",
        calldata: ["0x1", 2n],
      }),
    ).toEqual({
      contractAddress: POOL,
      entrypoint: "apply_actions",
      calldata: ["0x1", "0x2"],
    });
  });

  it("accepts the SDK's camelCase shape", () => {
    expect(
      normalizeCall({
        contractAddress: POOL,
        entrypoint: "apply_actions",
        calldata: [],
      }),
    ).toMatchObject({ contractAddress: POOL, entrypoint: "apply_actions" });
  });

  it("refuses a call it cannot read rather than guessing", () => {
    expect(() => normalizeCall({ calldata: ["0x1"] })).toThrow(/cannot read/i);
  });
});

describe("whether a transfer publishes who is being paid", () => {
  /* Felt 12 of the channel-opening donation relayed on Sepolia,
     tx 0x52136f70…dd9245 - the creator's address in plaintext calldata. */
  const opensChannel = {
    calldata: [
      "0x2d",
      "0xb",
      "0x1",
      "0x2d76e36009160f6bdb471f2bc6773ad8e356f66091a2f2a88a2ba69931d685a",
      "0x5952c860b483036297eddd7b6a608698c06ad65c829af100ecf9fd0229ba7a0",
    ],
  };

  it("spots the recipient however the felt is padded", () => {
    expect(namesRecipient(opensChannel, CREATOR)).toBe(true);
    expect(
      namesRecipient(
        { calldata: [CREATOR] },
        "0x2d76e36009160f6bdb471f2bc6773ad8e356f66091a2f2a88a2ba69931d685a",
      ),
    ).toBe(true);
  });

  it("says no when the transfer names nobody", () => {
    expect(
      namesRecipient(
        { calldata: ["0x1", "0x3ae13097667ae2c49d1f07b6f37ccc125ba1fc19222c309617bac5fb22efe8"] },
        CREATOR,
      ),
    ).toBe(false);
  });

  it("ignores calldata entries that are not felts", () => {
    expect(namesRecipient({ calldata: ["", "not a felt"] }, CREATOR)).toBe(
      false,
    );
  });
});
