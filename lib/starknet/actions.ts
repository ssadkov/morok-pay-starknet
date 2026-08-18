import { num, validateAndParseAddress, type WalletAccountV6 } from "starknet";

import type { ShieldToken } from "./tokens";

export function toFelt(amount: bigint) {
  if (amount <= BigInt(0)) {
    throw new Error("Amount must be greater than 0");
  }
  return num.toHex(amount);
}

export function privateBalanceFromEntries(
  entries: { token: string; balance: string }[],
  token: string,
) {
  const match = entries.find(
    (entry) => BigInt(entry.token) === BigInt(token),
  );
  return match ? BigInt(match.balance) : BigInt(0);
}

export async function shieldToken(
  account: WalletAccountV6,
  token: ShieldToken,
  amount: bigint,
) {
  return shieldAsset(account, token.address, amount);
}

export async function shieldAsset(
  account: WalletAccountV6,
  token: string,
  amount: bigint,
) {
  return account.strk20InvokeTransaction([
    {
      type: "deposit",
      token,
      amount: toFelt(amount),
    },
  ]);
}

export async function payoutToken(
  account: WalletAccountV6,
  token: ShieldToken,
  amount: bigint,
  recipient: string,
) {
  return account.strk20InvokeTransaction([
    {
      type: "withdraw",
      token: token.address,
      amount: toFelt(amount),
      recipient: validateAndParseAddress(recipient),
    },
  ]);
}

export async function transferPrivate(
  account: WalletAccountV6,
  token: ShieldToken,
  amount: bigint,
  recipient: string,
  invoke?: { contract: string; calldata?: string[] },
) {
  const actions: Parameters<WalletAccountV6["strk20InvokeTransaction"]>[0] = [
    {
      type: "transfer",
      token: token.address,
      amount: toFelt(amount),
      recipient: validateAndParseAddress(recipient),
    },
  ];
  if (invoke?.contract) {
    actions.push({
      type: "invoke",
      contract: validateAndParseAddress(invoke.contract),
      calldata: invoke.calldata ?? [],
    });
  }
  return account.strk20InvokeTransaction(actions);
}
