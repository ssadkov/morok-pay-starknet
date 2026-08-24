import { describe, expect, it } from "vitest";

import { privacyKeyTypedData, signatureFingerprint } from "./eip712-test";

describe("privacyKeyTypedData", () => {
  it("binds the derivation request to the EVM account and chain", () => {
    const data = privacyKeyTypedData({
      evmAddress: "0x1111111111111111111111111111111111111111",
      evmChainId: 11155111,
    });
    expect(data.domain).toMatchObject({
      name: "MorokPay Privacy Access",
      version: "1",
      chainId: 11155111,
    });
    expect(data.message.evmAccount).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(data.message.starknetChain).toBe("SN_SEPOLIA");
  });

  it("creates a stable non-secret fingerprint", () => {
    expect(signatureFingerprint("0x1234")).toBe(signatureFingerprint("0x1234"));
    expect(signatureFingerprint("0x1234")).not.toBe(signatureFingerprint("0x1235"));
    expect(signatureFingerprint("0x1234")).not.toContain("1234");
  });
});
