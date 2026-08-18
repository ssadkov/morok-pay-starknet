import { describe, expect, it } from "vitest";

import { parseSourceDomain } from "./attestation";

describe("parseSourceDomain", () => {
  it("defaults to Base", () => {
    expect(parseSourceDomain(null)).toBe(6);
    expect(parseSourceDomain("")).toBe(6);
  });

  it("accepts Starknet domain 25", () => {
    expect(parseSourceDomain("25")).toBe(25);
  });

  it("rejects non-integers", () => {
    expect(() => parseSourceDomain("base")).toThrow("Invalid source domain");
    expect(() => parseSourceDomain("256")).toThrow("Invalid source domain");
  });
});
