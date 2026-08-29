import { describe, expect, it } from "vitest";

import {
  deriveReceiveAccount,
  readyReceiveAccountTypedData,
  signatureEntropy,
  signaturesMatch,
} from "./receive-account";

describe("checking whether Ready's signature is safe to derive from", () => {
  it("accepts the same message on any device", () => {
    const first = readyReceiveAccountTypedData({ network: "sepolia" });
    const second = readyReceiveAccountTypedData({ network: "sepolia" });
    expect(first).toEqual(second);
  });

  it("is a different message per network, like the MetaMask one", () => {
    const sepolia = readyReceiveAccountTypedData({ network: "sepolia" });
    const mainnet = readyReceiveAccountTypedData({ network: "mainnet" });
    expect(sepolia).not.toEqual(mainnet);
  });

  it("says nothing about the main account in the message the wallet shows", () => {
    const typedData = readyReceiveAccountTypedData({ network: "sepolia" });
    const message = typedData.message as { purpose: string };
    expect(message.purpose).toContain("your donation QR publishes");
  });

  it("treats two equal signatures as a match regardless of shape", () => {
    expect(signaturesMatch(["0x1", "0x2"], ["0x01", "0x2"])).toBe(true);
    expect(signaturesMatch(["0x1", "0x2"], ["0x1", "0x3"])).toBe(false);
    expect(signaturesMatch(["0x1", "0x2"], ["0x1"])).toBe(false);
  });

  it("turns a match into the same account the EVM rail would derive from an equivalent blob", () => {
    const signature = ["0x1234", "0x5678"];
    const entropy = signatureEntropy(signature);
    expect(entropy).toMatch(/^0x[0-9a-f]{128}$/);
    const account = deriveReceiveAccount(entropy);
    /* Same inputs, same output - this is the whole point: whatever produced
       the entropy, derivation past that point is identical to the MetaMask
       rail, so nothing about B's security depends on which wallet made it. */
    expect(deriveReceiveAccount(signatureEntropy(signature))).toEqual(account);
  });

  it("does not collide two different signatures into the same entropy", () => {
    const a = signatureEntropy(["0x1", "0x2"]);
    const b = signatureEntropy(["0x2", "0x1"]);
    expect(a).not.toBe(b);
  });
});
