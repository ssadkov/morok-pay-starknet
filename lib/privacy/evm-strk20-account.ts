import {
  getAddress,
  padHex,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import {
  Account,
  cairo,
  ec,
  num,
  RpcProvider,
  validateAndParseAddress,
  type Call,
} from "starknet";
import {
  createPrivateTransfers,
  Open,
  SetupRequirement,
  type CallAndProof,
  type Note,
} from "@starkware-libs/starknet-privacy-sdk";
import { deriveViewingKey } from "@starkware-libs/starknet-privacy-client";
import {
  Eip712TypedDataSigner,
  type CallSetTypedData,
} from "@starkware-libs/starknet-privacy-client/signers";

import {
  Eth712TransactionSigner,
  ETH712_TEST_MAXIMUM_GAS_FEE,
  eth712FundedResourceBounds,
  ethSignatureToAccountFelts,
} from "@/lib/privacy/eth712-transaction";
import { privacyKeyTypedData } from "@/lib/privacy/eip712-test";
import { poolPublicKey } from "@/lib/starknet/account-status";
import {
  namesRecipient,
  normalizeCall,
  relaySubmission,
} from "@/lib/privacy/relay-client";
import {
  eth712OutsideExecutionTypedData,
  type OutsideExecutionIntent,
} from "@/lib/privacy/eth712-outside-execution";
import { privacySdkOf } from "@/lib/privacy/network";
import type { AppNetwork } from "@/lib/network";
import { readPoolFee } from "@/lib/starknet/pool-fee";
import { STRK_ADDRESS } from "@/lib/starknet/constants";
import { getAccountSnapshot } from "@/lib/starknet/status";

const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = BigInt("0x50524f4f4631");

/**
 * `amount` is a decimal string of base units, except on a transfer, where
 * `OPEN` asks for an open note - one whose amount a helper contract fills in
 * later. That is how the escrow pays a claimer: the note is created empty in
 * the same action set the escrow deposits into.
 */
export const OPEN_NOTE = "OPEN";

/**
 * Where a created open note's id belongs inside a helper's calldata. The id
 * is not known until the action set is compiled, so the caller writes this
 * marker and the account substitutes it.
 */
export const OPEN_NOTE_ID = "${openNoteIds[0]}";

export type Strk20Action =
  | { type: "register" }
  | { type: "setup"; recipient: string }
  | { type: "deposit"; token: string; amount: string }
  | { type: "withdraw"; token: string; amount: string; recipient: string }
  | { type: "transfer"; token: string; amount: string; recipient: string }
  | { type: "invoke"; contract: string; calldata?: string[] };

export type Strk20SubmitOptions = {
  /**
   * Submit through MorokPay's relayer and let it pay, instead of deciding
   * from whether the calldata names anybody. An escrow claim always wants
   * this: the whole point is that the claimer holds no STRK.
   */
  relay?: boolean;
};

/** Which wallet prompt is on screen, so the UI can explain the sequence. */
export type SignatureProgress = {
  step: number;
  total: number;
  label: string;
};

export type MorokPrivateAccount = {
  provider: RpcProvider;
  strk20Balances(tokens: string[]): Promise<{ token: string; balance: string }[]>;
  strk20InvokeTransaction(
    actions: Strk20Action[],
    submit?: Strk20SubmitOptions,
  ): Promise<{
    transaction_hash: string;
  }>;
  /**
   * An ordinary call set with no proof attached - a public ERC-20 transfer
   * out of this account, and nothing else so far. The Eth712 class validates
   * an EIP-712 signature for these exactly as it does for the proof-carrying
   * ones, so the only difference here is that `proof` is absent.
   */
  execute(calls: Call[]): Promise<{ transaction_hash: string }>;
  /**
   * Signs an intent for somebody else to submit and pay for. The account class
   * registers SRC9 for exactly this, and rebuilds the hash from the struct as
   * EIP-712 - so what a paymaster displays does not matter, only these bytes.
   */
  signOutsideExecution(intent: OutsideExecutionIntent): Promise<{
    typedData: ReturnType<typeof eth712OutsideExecutionTypedData>;
    signature: string[];
  }>;
  /**
   * Who this account has opened a private channel to, from its own viewing
   * key - not a log the app kept, a fact the pool's own state can still
   * answer from any device. It cannot say how much or when: a channel only
   * carries the recipient's public key and a per-token note count, because
   * the notes it created are encrypted to the *recipient's* key material,
   * not this account's. Ready X holds its own viewing key and does not
   * expose this to the page, so it is EVM-only.
   */
  discoverChannels(): Promise<{ recipient: string; noteCount: number }[]>;
};

type SignTypedData = (typedData: Record<string, unknown>) => Promise<Hex>;

function normalizedCallSet(typedData: CallSetTypedData) {
  return {
    ...typedData,
    domain: {
      ...typedData.domain,
      chainId: BigInt(typedData.domain.chainId),
      verifyingContract: getAddress(
        padHex(typedData.domain.verifyingContract as `0x${string}`, { size: 20 }),
      ),
    },
    message: {
      calls: typedData.message.calls.map((call) => ({
        address: BigInt(call.address),
        selector: BigInt(call.selector),
        data: call.data.map(BigInt),
      })),
      additional_data: typedData.message.additional_data.map(BigInt),
    },
  } as const;
}

function approvalCall(token: string, amount: bigint, poolAddress: string): Call {
  const value = cairo.uint256(amount);
  return {
    contractAddress: token,
    entrypoint: "approve",
    calldata: [poolAddress, value.low.toString(), value.high.toString()],
  };
}

/**
 * What an action set has to spend, and what it may fund out of its own
 * deposits.
 *
 * A deposit in the same set can pay for a withdrawal, so only the excess has
 * to come out of notes the account already holds. But the set still has to
 * spend *something*: one that nullifies nothing can be replayed, and the pool
 * refuses it with `NO_REPLAY_PROTECTION` - measured on Sepolia. So a fully
 * deposit-funded withdrawal still consumes one note, whose value comes
 * straight back through `surplusTo`.
 */
export function spendPlan(actions: Strk20Action[]): {
  spend: bigint;
  deposited: bigint;
  needed: bigint;
} {
  let spend = BigInt(0);
  let deposited = BigInt(0);
  for (const action of actions) {
    if (action.type === "deposit") {
      deposited += BigInt(action.amount);
    } else if (action.type === "withdraw") {
      spend += BigInt(action.amount);
    } else if (action.type === "transfer" && action.amount !== OPEN_NOTE) {
      spend += BigInt(action.amount);
    }
  }
  return { spend, deposited, needed: spend > deposited ? spend - deposited : BigInt(0) };
}

/**
 * Which notes to spend, smallest first so small notes get consolidated rather
 * than stranded. Always returns at least one note when anything is spent, for
 * the replay-protection reason above.
 */
export function selectSpendNotes(
  notes: Note[],
  needed: bigint,
): { selected: Note[]; total: bigint; covered: boolean } {
  const sorted = [...notes].sort((left, right) =>
    left.amount < right.amount ? -1 : left.amount > right.amount ? 1 : 0,
  );
  const selected: Note[] = [];
  let total = BigInt(0);
  for (const note of sorted) {
    if (total >= needed && selected.length) break;
    selected.push(note);
    total += note.amount;
  }
  return { selected, total, covered: total >= needed && selected.length > 0 };
}

/**
 * The ERC-20 approvals the pool needs before it can pull anything.
 *
 * A deposit pulls its own token out of the public balance; the pool fee is
 * always STRK. When STRK is itself deposited the two share one approval, so
 * both sides of that lookup have to go through the same address normaliser -
 * the constant is written short and the action's token arrives padded.
 */
export function poolApprovals(args: {
  actions: Strk20Action[];
  poolFee: bigint;
  poolAddress: string;
}): Call[] {
  const deposits = new Map<string, bigint>();
  for (const action of args.actions) {
    if (action.type !== "deposit") continue;
    const token = validateAndParseAddress(action.token);
    deposits.set(token, (deposits.get(token) ?? BigInt(0)) + BigInt(action.amount));
  }
  const strk = validateAndParseAddress(STRK_ADDRESS);
  return [
    approvalCall(
      STRK_ADDRESS,
      (deposits.get(strk) ?? BigInt(0)) + args.poolFee,
      args.poolAddress,
    ),
    ...[...deposits]
      .filter(([token]) => token !== strk)
      .map(([token, amount]) => approvalCall(token, amount, args.poolAddress)),
  ];
}

export function createEvmStrk20Account(options: {
  starknetAddress: string;
  evmAddress: string;
  evmChainId: number;
  network: AppNetwork;
  signTypedData: SignTypedData;
  /** Called before each wallet prompt, then with null once the run ends. */
  onSignatureProgress?: (progress: SignatureProgress | null) => void;
}): MorokPrivateAccount {
  const sdk = privacySdkOf(options.network);
  const provider = new RpcProvider({
    nodeUrl: sdk.privacyRpcUrl,
    specVersion: "0.10.3",
  });
  let viewingKey: bigint | null = null;

  /*
   * One STRK20 action costs several wallet prompts - reading the private
   * balance, authorising the private call set, then the Starknet transaction
   * itself - and unexplained back-to-back prompts read as something being
   * wrong. Announce which prompt is which and how many are coming. The total
   * is what this code knows it will ask for; if anything asks for more, the
   * count grows rather than reporting an impossible "4 of 3".
   */
  let run: { total: number; done: number } | null = null;
  let phase = "";

  function startRun(total: number, firstPhase: string) {
    run = { total, done: 0 };
    phase = firstPhase;
  }

  function endRun() {
    run = null;
    options.onSignatureProgress?.(null);
  }

  /* A relayed donation never asks for the Starknet transaction signature -
     MorokPay signs that one - so the count announced up front shrinks once the
     flow knows it is relaying. */
  function reviseRunTotal(remaining: number) {
    if (run) run.total = run.done + remaining;
  }

  async function checkedSignature(typedData: Record<string, unknown>) {
    if (run) {
      run.done += 1;
      options.onSignatureProgress?.({
        step: run.done,
        total: Math.max(run.total, run.done),
        label: phase,
      });
    }
    const signature = await options.signTypedData(typedData);
    const recovered = await recoverTypedDataAddress({
      ...(typedData as Parameters<typeof recoverTypedDataAddress>[0]),
      signature,
    });
    if (recovered.toLowerCase() !== options.evmAddress.toLowerCase()) {
      throw new Error(
        `MetaMask signed with ${recovered}, expected ${options.evmAddress}.`,
      );
    }
    return signature;
  }

  async function deriveWith(evmChainId?: number) {
    const request = privacyKeyTypedData({
      evmAddress: options.evmAddress as `0x${string}`,
      evmChainId,
      starknetChain: sdk.snChainName,
      privacyPool: BigInt(sdk.poolAddress),
      accountFactory: BigInt(sdk.accountFactory),
    });
    const signature = await checkedSignature(
      request as unknown as Record<string, unknown>,
    );
    return BigInt(deriveViewingKey(signature, options.starknetAddress));
  }

  /**
   * The pinned derivation first, and the old wallet-chain one only to rescue an
   * account registered before it was pinned.
   *
   * A viewing key cannot be re-registered, so an account whose key was derived
   * under the old rule would otherwise be unreadable forever - and the pool
   * publishes the public key, which is exactly enough to tell the two apart
   * without a wrong guess ever reaching the indexer.
   */
  async function getViewingKey() {
    if (viewingKey !== null) return viewingKey;
    const candidate = await deriveWith();
    const registered = await poolPublicKey(
      options.network,
      options.starknetAddress,
    );
    const publicKeyOf = (key: bigint) =>
      BigInt(ec.starkCurve.getStarkKey(num.toHex(key)));
    if (registered === null || publicKeyOf(candidate) === registered) {
      viewingKey = candidate;
      return viewingKey;
    }
    const legacy = await deriveWith(options.evmChainId);
    if (publicKeyOf(legacy) !== registered) {
      throw new Error(
        "This wallet does not derive the viewing key registered for this account. If it was activated on a different EVM network, switch back to it and reload.",
      );
    }
    viewingKey = legacy;
    return viewingKey;
  }

  const callSetSigner = new Eip712TypedDataSigner({
    accountAddress: options.starknetAddress,
    snChainName: sdk.snChainName,
    evmChainId: options.evmChainId,
    signTypedData: async (typedData) =>
      checkedSignature(
        normalizedCallSet(typedData) as unknown as Record<string, unknown>,
      ),
  });

  const transfers = createPrivateTransfers({
    account: { address: options.starknetAddress, signer: callSetSigner },
    viewingKeyProvider: { getViewingKey },
    provingProvider: {
      url: sdk.proverUrl,
      chainId: sdk.starknetChainId,
      nodeUrl: sdk.privacyRpcUrl,
      ohttp: true,
    },
    discoveryProvider: { url: sdk.discoveryUrl },
    poolContractAddress: sdk.poolAddress,
  });

  const account = new Account({
    provider,
    address: options.starknetAddress,
    signer: new Eth712TransactionSigner({
      accountAddress: options.starknetAddress,
      snChainName: sdk.snChainName,
      evmChainId: options.evmChainId,
      signTypedData: async (typedData) =>
        checkedSignature(typedData as unknown as Record<string, unknown>),
    }),
    cairoVersion: "1",
  });

  return {
    provider,
    async strk20Balances(tokens) {
      // Only prompts when the viewing key is not cached yet, but that first
      // prompt arrives unannounced during a balance refresh otherwise.
      if (viewingKey === null) {
        startRun(1, "Approve reading your private balance");
      }
      try {
        const discovered = await transfers.discoverNotes({
          tokens: tokens.map(BigInt),
        });
        return tokens.map((token) => ({
          token,
          balance: (discovered.notes.get(BigInt(token)) ?? [])
            .reduce((sum, note) => sum + note.amount, 0n)
            .toString(),
        }));
      } finally {
        endRun();
      }
    },
    async strk20InvokeTransaction(actions, submit) {
      /* One action per transaction was the old limit here, and it ruled out
         every helper flow: parking money in the escrow is withdraw *and*
         invoke, and claiming it back is a note *and* invoke. The pool allows
         one invoke phase per transaction and any number of token actions
         alongside it, so that is the shape enforced now. */
      const invokes = actions.filter((item) => item.type === "invoke");
      if (invokes.length > 1) {
        throw new Error(
          "The pool runs at most one contract invoke per transaction.",
        );
      }
      const invoke = invokes[0];
      const registers = actions.some((item) => item.type === "register");
      const setups = actions.filter((item) => item.type === "setup");
      const tokenActions = actions.filter(
        (item) =>
          item.type === "deposit" ||
          item.type === "withdraw" ||
          item.type === "transfer",
      );
      if (!tokenActions.length && !registers) {
        throw new Error("This STRK20 transaction has nothing to do.");
      }
      /* Shield and unshield hand-roll the approvals and proof call that
         Ready X's extension normally does internally, and were held to Sepolia
         while that was unproven. Opened on mainnet 2026-08-30: everything the
         path depends on already runs there - the mainnet prover and discovery
         service answer, the account factory and class are declared, and
         registration and transfer have all gone through with real money. The
         lab remains linked from the balances sidebar for anyone who wants the
         proof and fee review shown step by step. */
      /* Always the call set and the Starknet transaction, plus the viewing
         key when this session has not derived it yet. */
      startRun(
        viewingKey === null ? 3 : 2,
        "Approve reading your private balance",
      );
      try {
      const latestBlock = await provider.getBlockNumber();
      const provingBlock = latestBlock - PROVING_BLOCK_DEPTH;
      const poolFee = await readPoolFee(options.network);

      /*
       * Spending needs its input notes named explicitly. The builder only
       * picks notes on its own when ExecuteOptions.autoSelectNotes is set,
       * so without either the proof is built over an empty input set and the
       * pool rejects it as "total available: 0" no matter how much is in the
       * account. Notes are discovered at the proving block because that is
       * the state the proof is checked against - a note the latest block can
       * see but the proving block cannot is not yet spendable.
       */
      /*
       * Only the first transfer to a given recipient publishes anything about
       * who is involved: it carries `Append { recipient_addr }` in plaintext
       * calldata, and if the donor sends it themselves, the chain has the pair.
       * That one goes through MorokPay's relayer. Once the channel exists,
       * later transfers name nobody and the donor may as well pay their own
       * fee.
       */
      for (const action of tokenActions) {
        if (action.type !== "transfer" || action.amount === OPEN_NOTE) continue;
        const requirement = await transfers.discoverRequirement(
          validateAndParseAddress(action.recipient),
          validateAndParseAddress(action.token),
        );
        if (requirement === SetupRequirement.Register) {
          throw new Error(
            "This recipient has no viewing key in the STRK20 pool yet, so nothing can be sent to them privately.",
          );
        }
      }

      const byToken = new Map<string, typeof tokenActions>();
      for (const action of tokenActions) {
        const token = validateAndParseAddress(action.token);
        byToken.set(token, [...(byToken.get(token) ?? []), action]);
      }

      const inputsByToken = new Map<string, Note[]>();
      for (const [token, group] of byToken) {
        const { deposited, spend, needed } = spendPlan(group);
        if (spend === BigInt(0)) continue;

        const discovered = await transfers.discoverNotes({
          tokens: [BigInt(token)],
          blockIdentifier: provingBlock,
        });
        const { selected, total, covered } = selectSpendNotes(
          discovered.notes.get(BigInt(token)) ?? [],
          needed,
        );
        if (!covered) {
          /* Separate three failures that look alike from the outside: an
             account short of funds, one whose note the proving block cannot
             see yet, and one with no private balance at all - which cannot
             even be replay-protected, however much public balance it has. */
          const latest = await transfers.discoverNotes({ tokens: [BigInt(token)] });
          const latestNotes = latest.notes.get(BigInt(token)) ?? [];
          const latestTotal = latestNotes.reduce(
            (sum, note) => sum + note.amount,
            BigInt(0),
          );
          if (!latestNotes.length && deposited > BigInt(0)) {
            throw new Error(
              "This account has no private balance yet, and a transaction that spends nothing cannot be replay-protected. Shield once on its own first.",
            );
          }
          throw new Error(
            latestTotal < needed
              ? `This account holds ${latestTotal} of the ${needed} it still needs for this transaction.`
              : `The balance is there, but proving block ${provingBlock} still sees only ${total}. Wait until the note is at least ${PROVING_BLOCK_DEPTH} blocks old, then try again.`,
          );
        }
        inputsByToken.set(token, selected);
      }

      let builder = transfers.build({ autoSetup: true });
      if (registers) builder = builder.register();
      for (const action of setups) {
        builder = builder.setup(validateAndParseAddress(action.recipient));
      }
      for (const [token, group] of byToken) {
        builder = builder.with(token, (operations) => {
          const inputs = inputsByToken.get(token) ?? [];
          if (inputs.length) operations.inputs(...inputs);
          /* A fresh account has neither a channel nor a per-token subchannel.
             autoSetup covers the channel; without this the pool answers
             SUBCHANNEL_NOT_FOUND. */
          for (const action of setups) {
            operations.setup(validateAndParseAddress(action.recipient));
          }
          for (const action of group) {
            if (action.type === "deposit") {
              operations.deposit({ amount: BigInt(action.amount) });
            } else if (action.type === "withdraw") {
              operations.withdraw({
                recipient: validateAndParseAddress(action.recipient),
                amount: BigInt(action.amount),
              });
            } else {
              operations.transfer({
                recipient: validateAndParseAddress(action.recipient),
                amount:
                  action.amount === OPEN_NOTE ? Open : BigInt(action.amount),
              });
            }
          }
        });
      }
      if (invoke) {
        builder = builder.invoke(({ openNotes }) => ({
          contractAddress: validateAndParseAddress(invoke.contract),
          /* The open note's id only exists once the set is compiled, so the
             caller writes OPEN_NOTE_ID and it is substituted here. */
          calldata: (invoke.calldata ?? []).map((value) =>
            value === OPEN_NOTE_ID
              ? num.toHex(openNotes[0]?.noteId ?? BigInt(0))
              : value,
          ),
        }));
      }
      builder = builder.surplusTo(options.starknetAddress);
      phase = "Authorise the private transfer";
      const invocation = await builder.createProofInvocation({
        provingBlockId: provingBlock,
      });
      const result = await transfers.executeWithInvocation(
        invocation,
        provingBlock,
      );
      const callAndProof: CallAndProof = result.callAndProof;
      if (
        !callAndProof.proof.proofFacts.length ||
        BigInt(callAndProof.proof.proofFacts[0]) !== PROOF1_VERSION
      ) {
        throw new Error("The prover returned unsupported proof facts.");
      }
      const relayable = normalizeCall(
        callAndProof.call as Parameters<typeof normalizeCall>[0],
      );
      /* Decided from the proven call rather than from the SDK's view of
         whether a channel is missing: the address either is in this calldata
         or it is not, and that is the leak itself rather than a prediction of
         it. The proof is built either way, so knowing later costs nothing. */
      const relayedTransfer = tokenActions.find(
        (item) =>
          item.type === "transfer" &&
          item.amount !== OPEN_NOTE &&
          namesRecipient(relayable, item.recipient),
      );
      if (submit?.relay || relayedTransfer) {
        /* MorokPay approves the fee from its own balance, because the pool
           charges get_caller_address(). Nothing else about this account goes
           with the proof - and no Starknet signature is asked of the donor.
           An escrow claim asks for this explicitly rather than by inference:
           the claimer has no STRK to pay with, which is the whole point. */
        reviseRunTotal(0);
        return relaySubmission({
          network: options.network,
          call: relayable,
          proof: callAndProof.proof.data,
          proofFacts: callAndProof.proof.proofFacts.map(String),
        });
      }
      const approvals = poolApprovals({
        actions: tokenActions,
        poolFee,
        poolAddress: sdk.poolAddress,
      });
      const strkSpend =
        spendPlan(
          tokenActions.filter(
            (item) =>
              validateAndParseAddress(item.token) ===
              validateAndParseAddress(STRK_ADDRESS),
          ),
        ).deposited + poolFee;
      const calls = [...approvals, callAndProof.call];
      const proofDetails = {
        proof: callAndProof.proof.data,
        proofFacts: callAndProof.proof.proofFacts,
      };
      const [nonceValue, snapshot] = await Promise.all([
        account.getNonce(),
        getAccountSnapshot(options.starknetAddress, options.network),
      ]);
      const nonce = BigInt(nonceValue);
      const estimate = await account.estimateInvokeFee(calls, {
        nonce,
        skipValidate: true,
        tip: 0n,
        ...proofDetails,
      });
      const resourceBounds = eth712FundedResourceBounds({
        estimated: estimate.resourceBounds,
        publicBalance: snapshot.strkWei,
        transferAmount: strkSpend,
        maximumFeeCap: ETH712_TEST_MAXIMUM_GAS_FEE,
      });
      phase = "Sign the Starknet transaction";
      const submission = await account.execute(calls, {
        nonce,
        resourceBounds,
        tip: 0n,
        ...proofDetails,
      });
      return { transaction_hash: String(submission.transaction_hash) };
      } finally {
        endRun();
      }
    },
    async signOutsideExecution(intent) {
      const typedData = eth712OutsideExecutionTypedData({
        accountAddress: options.starknetAddress,
        snChainName: sdk.snChainName,
        evmChainId: options.evmChainId,
        intent,
      });
      startRun(1, "Approve the gasless transaction");
      try {
        const signature = await options.signTypedData(
          typedData as unknown as Record<string, unknown>,
        );
        return {
          typedData,
          /* Always the six-felt array the account's `extract_signature`
             wants; the SDK's wider Signature type is the only reason for the
             cast. */
          signature: ethSignatureToAccountFelts(
            signature,
            options.evmChainId,
          ) as string[],
        };
      } finally {
        endRun();
      }
    },
    async discoverChannels() {
      // Same cache, same first-prompt story as strk20Balances above - the
      // key this needs is the same one, so a balance read earlier in the
      // session means this asks for nothing new.
      if (viewingKey === null) {
        startRun(1, "Approve reading your private balance");
      }
      try {
        const discovered = await transfers.discoverChannels("all");
        const result: { recipient: string; noteCount: number }[] = [];
        discovered.channels?.forEach((channel, recipient) => {
          let noteCount = 0;
          channel.tokens.forEach((tokenChannel) => {
            noteCount += tokenChannel.noteNonce;
          });
          result.push({
            recipient: validateAndParseAddress(num.toHex(recipient)),
            noteCount,
          });
        });
        return result;
      } finally {
        endRun();
      }
    },
    async execute(calls) {
      startRun(1, "Sign the Starknet transaction");
      try {
        const [nonceValue, snapshot] = await Promise.all([
          account.getNonce(),
          getAccountSnapshot(options.starknetAddress, options.network),
        ]);
        const nonce = BigInt(nonceValue);
        const estimate = await account.estimateInvokeFee(calls, {
          nonce,
          skipValidate: true,
          tip: 0n,
        });
        /* transferAmount is zero even when the call moves STRK: the caller
           already withheld a gas reserve, and double-counting it here would
           reject sends this account can comfortably afford. */
        const resourceBounds = eth712FundedResourceBounds({
          estimated: estimate.resourceBounds,
          publicBalance: snapshot.strkWei,
          transferAmount: 0n,
          maximumFeeCap: ETH712_TEST_MAXIMUM_GAS_FEE,
        });
        const submission = await account.execute(calls, {
          nonce,
          resourceBounds,
          tip: 0n,
        });
        return { transaction_hash: String(submission.transaction_hash) };
      } finally {
        endRun();
      }
    },
  };
}
