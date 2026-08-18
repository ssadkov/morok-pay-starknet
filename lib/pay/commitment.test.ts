import { describe, expect, it } from "vitest";

import {
  commitmentFromFelts,
  computeInvoiceCommitment,
  invoiceSeqFelt,
  isCommitment,
} from "./commitment";

describe("commitmentFromFelts", () => {
  it("matches the Cairo test vector", () => {
    // contracts/tests/test_commitment.cairo: compute_commitment(11, 1)
    expect(BigInt(commitmentFromFelts("0xb", "0x1"))).toBe(
      BigInt(
        "0x01e0357743602697d85e4f3e679ffb49752e6fd65fdef8579a1de9d0544f882f",
      ),
    );
  });
});

describe("invoiceSeqFelt", () => {
  it("encodes a short invoice number as a single felt", () => {
    expect(invoiceSeqFelt("INV-1")).toBe("0x494e562d31");
  });

  it("folds invoice numbers longer than 31 bytes into one felt", () => {
    const long = "INV-".padEnd(80, "9");
    expect(BigInt(invoiceSeqFelt(long))).toBeGreaterThan(BigInt(0));
  });
});

describe("computeInvoiceCommitment", () => {
  const secret = "0xb";

  it("is stable for the same secret and invoice", () => {
    expect(computeInvoiceCommitment({ secret, invoice: "INV-1" })).toBe(
      computeInvoiceCommitment({ secret, invoice: "INV-1" }),
    );
  });

  it("changes with the invoice number", () => {
    expect(computeInvoiceCommitment({ secret, invoice: "INV-1" })).not.toBe(
      computeInvoiceCommitment({ secret, invoice: "INV-2" }),
    );
  });

  it("changes with the merchant secret", () => {
    expect(computeInvoiceCommitment({ secret, invoice: "INV-1" })).not.toBe(
      computeInvoiceCommitment({ secret: "0xc", invoice: "INV-1" }),
    );
  });

  it("produces a value the contract accepts", () => {
    const commitment = computeInvoiceCommitment({ secret, invoice: "INV-1" });
    expect(isCommitment(commitment)).toBe(true);
    expect(BigInt(commitment)).not.toBe(BigInt(0));
  });
});

describe("isCommitment", () => {
  it("rejects junk", () => {
    expect(isCommitment(undefined)).toBe(false);
    expect(isCommitment("")).toBe(false);
    expect(isCommitment("nope")).toBe(false);
  });
});
