import { num, validateAndParseAddress, type WalletAccountV6 } from "starknet";

import { USDC_ADDRESS } from "./constants";

export function toFelt(amount: bigint) {
  if (amount <= BigInt(0)) {
    throw new Error("Amount must be greater than 0");
  }
  return num.toHex(amount);
}

export function privateUsdcFromBalances(
  entries: { token: string; balance: string }[],
) {
  const match = entries.find(
    (entry) => BigInt(entry.token) === BigInt(USDC_ADDRESS),
  );
  return match ? BigInt(match.balance) : BigInt(0);
}

export async function shieldUsdc(account: WalletAccountV6, amount: bigint) {
  return account.strk20InvokeTransaction([
    {
      type: "deposit",
      token: USDC_ADDRESS,
      amount: toFelt(amount),
    },
  ]);
}

export async function payoutUsdc(
  account: WalletAccountV6,
  amount: bigint,
  recipient: string,
) {
  return account.strk20InvokeTransaction([
    {
      type: "withdraw",
      token: USDC_ADDRESS,
      amount: toFelt(amount),
      recipient: validateAndParseAddress(recipient),
    },
  ]);
}
