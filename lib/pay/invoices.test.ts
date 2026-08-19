import { describe, expect, it } from "vitest";

import { nextInvoiceId } from "./invoices";

describe("nextInvoiceId", () => {
  it("returns an INV- prefix with four characters", () => {
    expect(nextInvoiceId()).toMatch(/^INV-[0-9A-Z]{4}$/);
  });

  it("supports a campaign-specific prefix", () => {
    expect(nextInvoiceId("DROP")).toMatch(/^DROP-[0-9A-Z]{4}$/);
  });
});
