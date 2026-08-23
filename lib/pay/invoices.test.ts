import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INVOICE_STORAGE_KEY,
  markInvoicePaid,
  nextInvoiceId,
  readInvoices,
  saveInvoice,
  setSaleFulfilled,
} from "./invoices";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nextInvoiceId", () => {
  it("returns a SALE- prefix with four characters", () => {
    expect(nextInvoiceId()).toMatch(/^SALE-[0-9A-Z]{4}$/);
  });

  it("supports a future invoice-specific prefix", () => {
    expect(nextInvoiceId("INV")).toMatch(/^INV-[0-9A-Z]{4}$/);
  });
});

describe("local sale lifecycle", () => {
  it("keeps paid and fulfilled timestamps as separate merchant states", () => {
    const store = new Map<string, string>();
    const globals = globalThis as { window?: unknown };
    const original = globals.window;
    globals.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
      dispatchEvent: () => true,
    };
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200);

    try {
      saveInvoice({
        network: "sepolia",
        to: "0x123",
        amount: "3",
        invoice: "SALE-TEST",
        label: "Coffee",
        kind: "sale",
        createdAt: 1,
        status: "unpaid",
      });

      markInvoicePaid("sepolia", "SALE-TEST");
      expect(readInvoices("sepolia")[0]).toMatchObject({
        status: "paid",
        paidAt: 100,
      });
      expect(readInvoices("sepolia")[0].fulfilledAt).toBeUndefined();

      setSaleFulfilled("sepolia", "SALE-TEST", true);
      expect(readInvoices("sepolia")[0]).toMatchObject({
        status: "paid",
        paidAt: 100,
        fulfilledAt: 200,
      });

      setSaleFulfilled("sepolia", "SALE-TEST", false);
      expect(readInvoices("sepolia")[0].fulfilledAt).toBeUndefined();
      expect(store.has(INVOICE_STORAGE_KEY)).toBe(true);
    } finally {
      globals.window = original;
    }
  });
});
