import { describe, expect, it } from "vitest";

import {
  MOROK_DONATION_FEE_USDC_RAW,
  donationDebit,
  morokDonationFee,
} from "./fees";

describe("morokDonationFee", () => {
  it("adds a fixed 0.01 USDC Sepolia fee", () => {
    const fee = morokDonationFee("sepolia", " 0x123 ");
    expect(fee).toEqual({
      amountRaw: MOROK_DONATION_FEE_USDC_RAW,
      recipient: "0x123",
    });
    expect(donationDebit(BigInt(2_000_000), fee)).toBe(BigInt(2_010_000));
  });

  it("keeps the unverified fee off mainnet", () => {
    expect(morokDonationFee("mainnet", "0x123")).toBeNull();
    expect(donationDebit(BigInt(2_000_000), null)).toBe(BigInt(2_000_000));
  });
});
