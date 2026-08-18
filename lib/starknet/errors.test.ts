import { describe, expect, it } from "vitest";

import { formatStrk20Error } from "./errors";

describe("formatStrk20Error", () => {
  it("explains NOT_REGISTERED", () => {
    expect(
      formatStrk20Error(new Error("An error occurred (NOT_REGISTERED)"), "shield"),
    ).toMatch(/not registered in the STRK20 pool/i);
  });
});
