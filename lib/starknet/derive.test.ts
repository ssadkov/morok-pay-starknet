import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import {
  accountDerivationMessage,
  deriveTreasuryFromSignature,
  starkPrivateKeyFromSignature,
} from "./derive";

const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const SIGNATURE = (`0x${"ab".repeat(65)}`) as Hex;

describe("deriveTreasuryFromSignature", () => {
  it("is deterministic for the same signature", () => {
    const first = deriveTreasuryFromSignature(OWNER, SIGNATURE);
    const second = deriveTreasuryFromSignature(OWNER, SIGNATURE);

    expect(first.privateKey).toBe(second.privateKey);
    expect(first.publicKey).toBe(second.publicKey);
    expect(first.address).toBe(second.address);
    expect(first.viewingKey).toBe(second.viewingKey);
  });

  it("uses a chain-independent derivation message", () => {
    expect(accountDerivationMessage(OWNER)).toContain(
      "owner: 0x1111111111111111111111111111111111111111",
    );
    expect(accountDerivationMessage(OWNER)).toContain(
      "action: derive-starknet-account-v1",
    );
  });

  it("returns a valid Stark address and viewing key range", () => {
    const treasury = deriveTreasuryFromSignature(OWNER, SIGNATURE);

    expect(treasury.address).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(treasury.privateKey).not.toBe(starkPrivateKeyFromSignature(`0x${"cd".repeat(65)}` as Hex));
    expect(treasury.viewingKey > BigInt(0)).toBe(true);
  });
});
