import {
  validateAndParseAddress,
  type Call,
  type WalletAccountV6,
} from "starknet";

import { STRK_ADDRESS } from "./constants";
import type { ShieldToken } from "./tokens";
import { WalletTimeoutError } from "./errors";
import { WALLET_SUBMISSION_TIMEOUT_MS } from "./transaction-confirmation";
import type {
  MorokPrivateAccount,
  Strk20Action,
} from "../privacy/evm-strk20-account";

/**
 * Ready sometimes drops the response when the user rejects the
 * strk20InvokeTransaction popup, so the wallet promise never settles and the
 * caller's spinner would otherwise never stop. Bound every wallet prompt so
 * the UI can recover and let the user retry.
 */
function withWalletTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new WalletTimeoutError());
    }, WALLET_SUBMISSION_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

type PrivateWalletAccount =
  | Pick<WalletAccountV6, "strk20InvokeTransaction">
  | MorokPrivateAccount;

/** Ready's Wallet API rejects padded felts in invoke calldata. */
const CALLDATA_FELT_RE =
  /^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$/;

export function toFelt(amount: bigint) {
  if (amount <= BigInt(0)) {
    throw new Error("Amount must be greater than 0");
  }
  return toCalldataFelt(amount);
}

export function toCalldataFelt(value: string | bigint): string {
  const hex = `0x${BigInt(value).toString(16)}`;
  if (!CALLDATA_FELT_RE.test(hex)) {
    throw new Error(`Value does not fit a Wallet API felt: ${value}`);
  }
  return hex;
}

function invokeCalldata(values: string[]): string[] {
  return values.map((value) =>
    value.startsWith("${") ? value : toCalldataFelt(value),
  );
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

export function publicStrkTransferCall(
  recipient: string,
  amount: bigint,
): Call {
  if (amount <= BigInt(0)) throw new Error("Amount must be greater than 0");
  const lowMask = (BigInt(1) << BigInt(128)) - BigInt(1);
  return {
    contractAddress: STRK_ADDRESS,
    entrypoint: "transfer",
    calldata: [
      validateAndParseAddress(recipient),
      toCalldataFelt(amount & lowMask),
      toCalldataFelt(amount >> BigInt(128)),
    ],
  };
}

export async function transferPublicStrk(
  account: WalletAccountV6,
  recipient: string,
  amount: bigint,
) {
  return withWalletTimeout(account.execute(publicStrkTransferCall(recipient, amount)));
}

export async function shieldToken(
  account: PrivateWalletAccount,
  token: ShieldToken,
  amount: bigint,
) {
  return shieldAsset(account, token.address, amount);
}

export async function shieldAsset(
  account: PrivateWalletAccount,
  token: string,
  amount: bigint,
) {
  return withWalletTimeout(
    account.strk20InvokeTransaction([
      {
        type: "deposit",
        token,
        amount: toFelt(amount),
      },
    ] as Strk20Action[] & Parameters<WalletAccountV6["strk20InvokeTransaction"]>[0]),
  );
}

export async function payoutToken(
  account: PrivateWalletAccount,
  token: ShieldToken,
  amount: bigint,
  recipient: string,
) {
  return withWalletTimeout(
    account.strk20InvokeTransaction([
      {
        type: "withdraw",
        token: token.address,
        amount: toFelt(amount),
        recipient: validateAndParseAddress(recipient),
      },
    ] as Strk20Action[] & Parameters<WalletAccountV6["strk20InvokeTransaction"]>[0]),
  );
}

export async function transferPrivate(
  account: PrivateWalletAccount,
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
      calldata: invokeCalldata(invoke.calldata ?? []),
    });
  }
  return withWalletTimeout(
    account.strk20InvokeTransaction(
      actions as Strk20Action[] &
        Parameters<WalletAccountV6["strk20InvokeTransaction"]>[0],
    ),
  );
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
  return withWalletTimeout(
    account.strk20InvokeTransaction([
      {
        type: "withdraw",
        token: tokenAddress,
        amount: toFelt(amount),
        recipient: contract,
      },
      {
        type: "invoke",
        contract,
        calldata: invokeCalldata([
          "0x0",
          commitment,
          tokenAddress,
          toFelt(amount),
          "0x0",
          "0x0",
        ]),
      },
    ]),
  );
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
  return withWalletTimeout(
    account.strk20InvokeTransaction([
      {
        type: "transfer",
        token: token.address,
        amount: "OPEN",
        recipient: validateAndParseAddress(recipient),
      },
      {
        type: "invoke",
        contract,
        calldata: invokeCalldata([
          "0x1",
          "0x0",
          "0x0",
          "0x0",
          secret,
          "${openNoteIds[0]}",
        ]),
      },
    ]),
  );
}
