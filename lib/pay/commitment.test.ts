import { describe, expect, it } from "vitest";

import { computeInvoiceCommitment, INVOICE_TAG } from "./commitment";

describe("invoice commitment", () => {
  it("matches the Cairo poseidon helper", () => {
    expect(INVOICE_TAG).toBe("0x4d4f524f4b5f494e564f4943453a5631");
    expect(BigInt(computeInvoiceCommitment(11, 1))).toBe(
      BigInt("0x1e0357743602697d85e4f3e679ffb49752e6fd65fdef8579a1de9d0544f882f"),
    );
  });

  it("changes when the sequence changes", () => {
    expect(computeInvoiceCommitment(11, 1)).not.toBe(
      computeInvoiceCommitment(11, 2),
    );
  });
});
