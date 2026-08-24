import type { AppNetwork } from "@/lib/network";

export const MOROK_DONATION_FEE_USDC_RAW = BigInt(10_000);

export type MorokDonationFee = {
  amountRaw: bigint;
  recipient: string;
};

/** Keep the test fee off mainnet until the Sepolia batch is verified. */
export function morokDonationFee(
  network: AppNetwork,
  treasury: string,
): MorokDonationFee | null {
  if (network !== "sepolia" || !treasury.trim()) return null;
  return {
    amountRaw: MOROK_DONATION_FEE_USDC_RAW,
    recipient: treasury.trim(),
  };
}

export function donationDebit(amountRaw: bigint, fee: MorokDonationFee | null) {
  return amountRaw + (fee?.amountRaw ?? BigInt(0));
}
