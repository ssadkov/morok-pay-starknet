import { describe, expect, it } from "vitest";

import {
  classifyPrivateDelta,
  findIncomingInvoice,
  sameAddress,
} from "./activity";
import type { MerchantInvoice } from "./invoices";

const seller =
  "0x00e5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423";

function invoice(
  overrides: Partial<MerchantInvoice> & Pick<MerchantInvoice, "invoice">,
): MerchantInvoice {
  return {
    network: "sepolia",
    to: seller,
    amount: "12.50",
    label: "Coffee",
    createdAt: 1,
    status: "unpaid",
    ...overrides,
  };
}

describe("sameAddress", () => {
  it("treats padded hex as equal", () => {
    expect(sameAddress("0x1", "0x01")).toBe(true);
    expect(sameAddress("0x2", "0x3")).toBe(false);
    expect(
      sameAddress(
        "0xe5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423",
        seller,
      ),
    ).toBe(true);
  });
});

describe("findIncomingInvoice", () => {
  it("returns the oldest unpaid invoice for the amount", () => {
    const invoices = [
      invoice({ invoice: "INV-OLD", createdAt: 1 }),
      invoice({ invoice: "INV-NEW", createdAt: 2, label: "Tea" }),
    ];
    const match = findIncomingInvoice(invoices, {
      merchant: seller,
      amountRaw: BigInt(12_500_000),
    });
    expect(match?.invoice).toBe("INV-OLD");
  });

  it("ignores invoices for another Ready address", () => {
    const match = findIncomingInvoice(
      [invoice({ invoice: "INV-OTHER", to: "0xabc" })],
      { merchant: seller, amountRaw: BigInt(12_500_000) },
    );
    expect(match).toBeNull();
  });
});

describe("classifyPrivateDelta", () => {
  const invoices = [invoice({ invoice: "INV-1" })];

  it("matches a Morok sale when private USDC rises by an open invoice", () => {
    expect(
      classifyPrivateDelta({
        delta: BigInt(12_500_000),
        invoices,
        merchant: seller,
        recentShield: false,
        recentPay: false,
        recentUnshield: false,
      }),
    ).toEqual({ kind: "sale", invoice: invoices[0] });
  });

  it("skips a rise that is a recent shield", () => {
    expect(
      classifyPrivateDelta({
        delta: BigInt(12_500_000),
        invoices,
        merchant: seller,
        recentShield: true,
        recentPay: false,
        recentUnshield: false,
      }),
    ).toEqual({ kind: "none" });
  });

  it("records an unlabeled private receive when no invoice matches", () => {
    expect(
      classifyPrivateDelta({
        delta: BigInt(3_000_000),
        invoices,
        merchant: seller,
        recentShield: false,
        recentPay: false,
        recentUnshield: false,
      }),
    ).toEqual({ kind: "receive", amountRaw: BigInt(3_000_000) });
  });

  it("skips a drop that this app just paid or unshielded", () => {
    expect(
      classifyPrivateDelta({
        delta: -BigInt(12_500_000),
        invoices,
        merchant: seller,
        recentShield: false,
        recentPay: true,
        recentUnshield: false,
      }),
    ).toEqual({ kind: "none" });
  });

  it("records an unlabeled private pay for other drops", () => {
    expect(
      classifyPrivateDelta({
        delta: -BigInt(1_000_000),
        invoices,
        merchant: seller,
        recentShield: false,
        recentPay: false,
        recentUnshield: false,
      }),
    ).toEqual({ kind: "pay", amountRaw: BigInt(1_000_000) });
  });

  it("ignores note-scan dust under 0.10 USDC", () => {
    expect(
      classifyPrivateDelta({
        delta: -BigInt(54_655),
        invoices,
        merchant: seller,
        recentShield: false,
        recentPay: false,
        recentUnshield: false,
      }),
    ).toEqual({ kind: "none" });
  });
});
