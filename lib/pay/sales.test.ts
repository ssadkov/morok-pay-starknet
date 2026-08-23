import { describe, expect, it } from "vitest";

import type { MerchantInvoice } from "./invoices";
import { summarizeSales } from "./sales";

function sale(overrides: Partial<MerchantInvoice>): MerchantInvoice {
  return {
    network: "sepolia",
    to: "0x123",
    amount: "3",
    invoice: "SALE-1",
    label: "Coffee",
    kind: "sale",
    createdAt: 1,
    status: "paid",
    ...overrides,
  };
}

describe("summarizeSales", () => {
  it("counts paid and fulfilled sales by product", () => {
    const summary = summarizeSales([
      sale({ invoice: "SALE-1", amount: "3", fulfilledAt: 10 }),
      sale({ invoice: "SALE-2", amount: "4.5" }),
      sale({ invoice: "SALE-3", label: "Tea", status: "unpaid" }),
    ]);

    expect(summary.paidCount).toBe(2);
    expect(summary.fulfilledCount).toBe(1);
    expect(summary.revenueRaw).toBe(BigInt(7_500_000));
    expect(summary.products).toEqual([
      { product: "Coffee", count: 2, revenueRaw: BigInt(7_500_000) },
    ]);
  });
});
