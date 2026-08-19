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

/** Park private USDC in the escrow. The pool withdraws to the helper first. */
export async function depositToEscrow(
  account: WalletAccountV6,
  token: ShieldToken,
  amount: bigint,
  escrow: string,
  commitment: string,
) {
  const contract = validateAndParseAddress(escrow);
  const tokenAddress = validateAndParseAddress(token.address);
  return account.strk20InvokeTransaction([
    {
      type: "withdraw",
      token: tokenAddress,
      amount: toFelt(amount),
      recipient: contract,
    },
    {
      type: "invoke",
      contract,
      calldata: [
        "0x0",
        commitment,
        tokenAddress,
        toFelt(amount),
        "0x0",
        "0x0",
      ],
    },
  ]);
}

/**
 * Claim parked USDC into an open note. The recipient must already be
 * registered in the pool; that is the point of the delay.
 */
export async function claimFromEscrow(
  account: WalletAccountV6,
  token: ShieldToken,
  recipient: string,
  escrow: string,
  secret: string,
) {
  const contract = validateAndParseAddress(escrow);
  return account.strk20InvokeTransaction([
    {
      type: "transfer",
      token: token.address,
      amount: "OPEN",
      recipient: validateAndParseAddress(recipient),
    },
    {
      type: "invoke",
      contract,
      calldata: [
        "0x1",
        "0x0",
        "0x0",
        "0x0",
        secret,
        "${openNoteIds[0]}",
      ],
    },
  ]);
}
