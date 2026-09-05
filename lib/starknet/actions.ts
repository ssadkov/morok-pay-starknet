import {
  validateAndParseAddress,
  type Call,
  type WalletAccountV6,
} from "starknet";

import type { AppNetwork } from "@/lib/network";
import {
  namesRecipient,
  normalizeCall,
  relaySubmission,
} from "@/lib/privacy/relay-client";

import { STRK_ADDRESS, starknetOf } from "./constants";
import { readPoolFee } from "./pool-fee";
import type { ShieldToken } from "./tokens";
import { WalletTimeoutError } from "./errors";
import { WALLET_SUBMISSION_TIMEOUT_MS } from "./transaction-confirmation";
import {
  OPEN_NOTE,
  OPEN_NOTE_ID,
  type MorokPrivateAccount,
  type Strk20Action,
} from "../privacy/evm-strk20-account";

/**
 * Ready X sometimes drops the response when the user rejects the
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

/** Ready X's Wallet API rejects padded felts in invoke calldata. */
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

/**
 * An ordinary public ERC-20 transfer out of the Starknet account.
 *
 * Nothing private happens here - no pool, no proof, no fee beyond gas - which
 * is the point: it is how a creator moves an unshielded balance on to an
 * exchange once they are done with it.
 */
export function publicTokenTransferCall(
  token: string,
  recipient: string,
  amount: bigint,
): Call {
  if (amount <= BigInt(0)) throw new Error("Amount must be greater than 0");
  const lowMask = (BigInt(1) << BigInt(128)) - BigInt(1);
  return {
    contractAddress: validateAndParseAddress(token),
    entrypoint: "transfer",
    calldata: [
      validateAndParseAddress(recipient),
      toCalldataFelt(amount & lowMask),
      toCalldataFelt(amount >> BigInt(128)),
    ],
  };
}

export function publicStrkTransferCall(
  recipient: string,
  amount: bigint,
): Call {
  return publicTokenTransferCall(STRK_ADDRESS, recipient, amount);
}

export async function transferPublicStrk(
  account: WalletAccountV6,
  recipient: string,
  amount: bigint,
) {
  return withWalletTimeout(account.execute(publicStrkTransferCall(recipient, amount)));
}

/** Either wallet rail can send an ordinary transfer; only the shapes differ. */
type PublicSender =
  | Pick<WalletAccountV6, "execute">
  | Pick<MorokPrivateAccount, "execute">;

export async function transferPublicToken(
  account: PublicSender,
  token: string,
  recipient: string,
  amount: bigint,
): Promise<{ transaction_hash: string }> {
  const call = publicTokenTransferCall(token, recipient, amount);
  const response = await withWalletTimeout(
    (account as Pick<MorokPrivateAccount, "execute">).execute([call]),
  );
  return { transaction_hash: String(response.transaction_hash) };
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

/**
 * A donation MorokPay will not send as-is, because sending it would put the
 * donor and the creator in one public transaction. Carries no blame: the
 * caller decides whether the donor accepts that and retries.
 */
export class PublicLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicLinkError";
  }
}

/** Whether this wallet can hand over a proof instead of submitting it. */
function canPrepareInvoke(
  account: PrivateWalletAccount,
): account is WalletAccountV6 {
  return (
    typeof (account as WalletAccountV6).strk20PrepareInvoke === "function" &&
    typeof (account as WalletAccountV6).executeWithProof === "function"
  );
}

/**
 * A wallet that has never heard of the method, as opposed to one that tried
 * and failed. Only the first justifies falling back to a plain submission.
 */
function looksUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not supported|unsupported|not implemented|unknown method|method not found|-32601|API_VERSION_NOT_SUPPORTED/i.test(
    message,
  );
}

function poolApprovalCall(poolAddress: string, amount: bigint): Call {
  return {
    contractAddress: STRK_ADDRESS,
    entrypoint: "approve",
    calldata: [
      validateAndParseAddress(poolAddress),
      toCalldataFelt(amount),
      "0x0",
    ],
  };
}

/**
 * Sends a private transfer, and keeps the donor out of it when the transfer
 * would otherwise name them.
 *
 * A channel exists per sender-recipient pair, so only the first transfer to a
 * given creator carries the channel-opening `Append` with their address in
 * plaintext. Submitted by the donor, that one transaction ties the two
 * together on chain forever; every later donation to the same creator names
 * nobody and is safe to send normally.
 *
 * Ready X builds the proof inside the extension. `wallet_strk20PrepareInvoke`
 * hands it over without submitting, which is the whole reason relaying works
 * on this rail too: the pool authorizes on the proof, not on the sender, so
 * MorokPay can send it instead. A wallet that lacks the method leaves us
 * unable to even tell whether this donation opens a channel - hence
 * PublicLinkError rather than a guess.
 */
export async function transferPrivate(
  account: PrivateWalletAccount,
  token: ShieldToken,
  amount: bigint,
  recipient: string,
  options: {
    network: AppNetwork;
    /** Set once the donor has been told the link becomes public and said yes. */
    allowPublicLink?: boolean;
    invoke?: { contract: string; calldata?: string[] };
  },
) {
  const actions: Parameters<WalletAccountV6["strk20InvokeTransaction"]>[0] = [
    {
      type: "transfer",
      token: token.address,
      amount: toFelt(amount),
      recipient: validateAndParseAddress(recipient),
    },
  ];
  if (options.invoke?.contract) {
    actions.push({
      type: "invoke",
      contract: validateAndParseAddress(options.invoke.contract),
      calldata: invokeCalldata(options.invoke.calldata ?? []),
    });
  }

  const submitThroughWallet = () =>
    withWalletTimeout(
      account.strk20InvokeTransaction(
        actions as Strk20Action[] &
          Parameters<WalletAccountV6["strk20InvokeTransaction"]>[0],
      ),
    );

  /* The EVM rail decides for itself inside MorokPrivateAccount, where the SDK
     and the proof already live. */
  if (!canPrepareInvoke(account)) return submitThroughWallet();

  let prepared;
  try {
    prepared = await withWalletTimeout(
      account.strk20PrepareInvoke(
        actions as Parameters<WalletAccountV6["strk20PrepareInvoke"]>[0],
      ),
    );
  } catch (error) {
    if (!looksUnsupported(error)) throw error;
    if (!options.allowPublicLink) {
      throw new PublicLinkError(
        "This wallet will not hand over the donation for MorokPay to send, so if this is your first donation to this creator the two addresses land in one public transaction. Nothing was submitted.",
      );
    }
    return submitThroughWallet();
  }

  const call = normalizeCall(
    prepared.call as Parameters<typeof normalizeCall>[0],
  );
  if (namesRecipient(call, recipient)) {
    return relaySubmission({
      network: options.network,
      call,
      proof: prepared.proof.data,
      proofFacts: prepared.proof.proof_facts.map(String),
    });
  }

  /* Names nobody, so there is nothing to hide behind a relay and no reason to
     spend MorokPay's fee. The donor submits the proof they just built, with
     the pool's fee approval in front of it. */
  const poolFee = await readPoolFee(options.network);
  return withWalletTimeout(
    account.executeWithProof(
      [poolApprovalCall(starknetOf(options.network).pool, poolFee), call],
      prepared.proof,
    ),
  );
}

/**
 * Park private USDC in the escrow. The pool withdraws to the helper first.
 *
 * Both rails now. The EVM session used to reject this because it accepted one
 * action per transaction and this is two - a withdrawal and the helper invoke
 * that records what was parked.
 */
export async function depositToEscrow(
  account: PrivateWalletAccount,
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
 * Claim parked funds into an open note.
 *
 * `register` folds the recipient's pool registration into the same action set,
 * which is what lets somebody who has never touched Starknet collect: one
 * proof, one transaction, and with `relay` it is MorokPay that submits and
 * pays. Measured end to end in scripts/sponsored-claim-probe.mjs - the
 * claimer's account never holds STRK.
 *
 * A fresh account needs both setups: `setup` here opens the channel, and the
 * EVM account adds the per-token subchannel the pool also insists on.
 */
export async function claimFromEscrow(
  account: PrivateWalletAccount,
  token: ShieldToken,
  recipient: string,
  escrow: string,
  secret: string,
  options?: { register?: boolean; relay?: boolean },
) {
  const contract = validateAndParseAddress(escrow);
  const owner = validateAndParseAddress(recipient);
  const actions: Strk20Action[] = [
    ...(options?.register
      ? ([{ type: "register" }, { type: "setup", recipient: owner }] as const)
      : []),
    {
      type: "transfer",
      token: token.address,
      amount: OPEN_NOTE,
      recipient: owner,
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
        OPEN_NOTE_ID,
      ]),
    },
  ];
  /* Only the EVM session takes submission options - Ready X's Wallet API has
     no relayer to point at, and its method takes one argument. */
  return withWalletTimeout(
    "signOutsideExecution" in account
      ? account.strk20InvokeTransaction(actions, { relay: options?.relay })
      : account.strk20InvokeTransaction(
          actions as Strk20Action[] &
            Parameters<WalletAccountV6["strk20InvokeTransaction"]>[0],
        ),
  );
}

/**
 * Park funds in MorokEscrowV2, owned by an address.
 *
 * The shape is V1's - the pool withdraws to the helper, then invokes it in the
 * same action set - but what gets recorded is different: who may claim, who
 * may take it back, when it stops being claimable, and whether the entry is
 * listed under its owner.
 *
 * `indexed` is the one field the app must not set for convenience. It is what
 * makes the entry findable from the owner's address alone, by the recipient
 * and by any stranger asking about the same address, so it belongs only to the
 * product that has no link to carry a seed.
 */
export async function depositToEscrowV2(
  account: PrivateWalletAccount,
  token: ShieldToken,
  amount: bigint,
  escrow: string,
  entry: {
    commitment: string;
    owner: string;
    refundOwner: string;
    /** Unix seconds. Zero would make the entry permanent and unrefundable. */
    expiresAt: bigint;
    indexed: boolean;
  },
) {
  const contract = validateAndParseAddress(escrow);
  const tokenAddress = validateAndParseAddress(token.address);
  const actions: Strk20Action[] = [
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
        "0x0", // EscrowOperation::Deposit
        entry.commitment,
        tokenAddress,
        toFelt(amount),
        validateAndParseAddress(entry.owner),
        validateAndParseAddress(entry.refundOwner),
        toFelt(entry.expiresAt),
        entry.indexed ? "0x1" : "0x0",
      ]),
    },
  ];
  return withWalletTimeout(
    account.strk20InvokeTransaction(
      actions as Strk20Action[] &
        Parameters<WalletAccountV6["strk20InvokeTransaction"]>[0],
    ),
  );
}

/**
 * The call that takes the money out of MorokEscrowV2.
 *
 * Not a pool operation at all - no proof, no pool fee, no registration - which
 * is why a V2 claim costs a fraction of V1's and needs nothing from the
 * claimer but a signature. It is an ordinary external, and the contract's only
 * question is whether the caller is the entry's owner.
 */
export function escrowV2ClaimCall(args: {
  escrow: string;
  commitment: string;
  destination: string;
}): Call {
  return {
    contractAddress: validateAndParseAddress(args.escrow),
    entrypoint: "claim",
    calldata: [
      toCalldataFelt(args.commitment),
      toCalldataFelt(validateAndParseAddress(args.destination)),
    ],
  };
}

/** The same, for a sender taking back an entry nobody claimed in time. */
export function escrowV2RefundCall(args: {
  escrow: string;
  commitment: string;
  destination: string;
}): Call {
  return {
    contractAddress: validateAndParseAddress(args.escrow),
    entrypoint: "refund",
    calldata: [
      toCalldataFelt(args.commitment),
      toCalldataFelt(validateAndParseAddress(args.destination)),
    ],
  };
}
