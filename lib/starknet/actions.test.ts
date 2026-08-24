import { describe, expect, it } from "vitest";

import { STRK_ADDRESS } from "./constants";
import {
  privateTransferActions,
  publicStrkTransferCall,
  toCalldataFelt,
} from "./actions";
import { getShieldToken } from "./tokens";

const WALLET_FELT_RE = /^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$/;

describe("toCalldataFelt", () => {
  it("keeps zero as 0x0", () => {
    expect(toCalldataFelt("0x0")).toBe("0x0");
    expect(toCalldataFelt(BigInt(0))).toBe("0x0");
  });

  it("strips the leading zeros Ready rejects in invoke calldata", () => {
    const padded =
      "0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343";
    const felt = toCalldataFelt(padded);
    expect(felt.startsWith("0x0")).toBe(false);
    expect(WALLET_FELT_RE.test(felt)).toBe(true);
    expect(BigInt(felt)).toBe(BigInt(padded));
  });

  it("leaves an already-canonical felt alone", () => {
    expect(toCalldataFelt("0x1")).toBe("0x1");
  });
});

describe("publicStrkTransferCall", () => {
  it("builds a standard STRK transfer with u256 calldata", () => {
    const recipient =
      "0x00E5887fC74A11d10Ad5dd2f69D3911Fb352d9b811528a9281Ca8aBAc8498423";
    expect(publicStrkTransferCall(recipient, BigInt(10) ** BigInt(16))).toEqual({
      contractAddress: STRK_ADDRESS,
      entrypoint: "transfer",
      calldata: [
        expect.stringMatching(/^0x[0-9a-f]+$/),
        "0x2386f26fc10000",
        "0x0",
      ],
    });
  });
});

describe("privateTransferActions", () => {
  it("batches the donation and treasury fee as private transfers", () => {
    const token = getShieldToken("usdc", "sepolia");
    const actions = privateTransferActions(token, BigInt(2_000_000), "0x123", {
      additionalTransfers: [
        { amount: BigInt(10_000), recipient: "0x456" },
      ],
    });

    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      type: "transfer",
      token: token.address,
      amount: "0x1e8480",
    });
    expect(actions[1]).toMatchObject({
      type: "transfer",
      token: token.address,
      amount: "0x2710",
    });
    expect(BigInt((actions[0] as { recipient: string }).recipient)).toBe(
      BigInt("0x123"),
    );
    expect(BigInt((actions[1] as { recipient: string }).recipient)).toBe(
      BigInt("0x456"),
    );
  });
});
