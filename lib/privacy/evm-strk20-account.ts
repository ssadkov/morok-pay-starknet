import {
  getAddress,
  padHex,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import {
  Account,
  cairo,
  RpcProvider,
  validateAndParseAddress,
  type Call,
} from "starknet";
import {
  createPrivateTransfers,
  type CallAndProof,
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
} from "@/lib/privacy/eth712-transaction";
import { privacyKeyTypedData } from "@/lib/privacy/eip712-test";
import { privacySdkOf } from "@/lib/privacy/network";
import type { AppNetwork } from "@/lib/network";
import { readPoolFee } from "@/lib/starknet/pool-fee";
import { STRK_ADDRESS } from "@/lib/starknet/constants";
import { getAccountSnapshot } from "@/lib/starknet/status";

const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = BigInt("0x50524f4f4631");

export type Strk20Action =
  | { type: "deposit"; token: string; amount: string }
  | { type: "withdraw"; token: string; amount: string; recipient: string }
  | { type: "transfer"; token: string; amount: string; recipient: string }
  | { type: "invoke"; contract: string; calldata?: string[] };

export type MorokPrivateAccount = {
  provider: RpcProvider;
  strk20Balances(tokens: string[]): Promise<{ token: string; balance: string }[]>;
  strk20InvokeTransaction(actions: Strk20Action[]): Promise<{
    transaction_hash: string;
  }>;
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

export function createEvmStrk20Account(options: {
  starknetAddress: string;
  evmAddress: string;
  evmChainId: number;
  network: AppNetwork;
  signTypedData: SignTypedData;
}): MorokPrivateAccount {
  const sdk = privacySdkOf(options.network);
  const provider = new RpcProvider({
    nodeUrl: sdk.privacyRpcUrl,
    specVersion: "0.10.3",
  });
  let viewingKey: bigint | null = null;

  async function checkedSignature(typedData: Record<string, unknown>) {
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

  async function getViewingKey() {
    if (viewingKey !== null) return viewingKey;
    const request = privacyKeyTypedData({
      evmAddress: options.evmAddress as `0x${string}`,
      evmChainId: options.evmChainId,
      starknetChain: sdk.snChainName,
      privacyPool: BigInt(sdk.poolAddress),
      accountFactory: BigInt(sdk.accountFactory),
    });
    const signature = await checkedSignature(
      request as unknown as Record<string, unknown>,
    );
    viewingKey = BigInt(deriveViewingKey(signature, options.starknetAddress));
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
      const discovered = await transfers.discoverNotes({
        tokens: tokens.map(BigInt),
      });
      return tokens.map((token) => ({
        token,
        balance: (discovered.notes.get(BigInt(token)) ?? [])
          .reduce((sum, note) => sum + note.amount, 0n)
          .toString(),
      }));
    },
    async strk20InvokeTransaction(actions) {
      if (actions.length !== 1) {
        throw new Error(
          "This EVM session can only submit one STRK20 action at a time.",
        );
      }
      const action = actions[0];
      if (action.type !== "transfer" && action.type !== "deposit" && action.type !== "withdraw") {
        throw new Error(
          "This EVM session does not support this STRK20 action yet.",
        );
      }
      /* Shield and unshield hand-roll the approvals and proof call that
         Ready's extension normally does internally, so they stay Sepolia-only
         until that path is proven out. Donate's transfer already runs on
         both networks. */
      if (action.type !== "transfer" && options.network !== "sepolia") {
        throw new Error(
          "Shield and unshield for an EVM wallet are available on Sepolia only for now. Use the EVM lab on mainnet.",
        );
      }
      const amount = BigInt(action.amount);
      const token = validateAndParseAddress(action.token);
      const isStrk = BigInt(token) === BigInt(STRK_ADDRESS);
      const latestBlock = await provider.getBlockNumber();
      const provingBlock = latestBlock - PROVING_BLOCK_DEPTH;
      const poolFee = await readPoolFee(options.network);
      const builder = transfers
        .build({ autoSetup: true })
        .with(token, (operations) => {
          if (action.type === "deposit") {
            operations.deposit({ amount });
          } else if (action.type === "withdraw") {
            operations.withdraw({
              recipient: validateAndParseAddress(action.recipient),
              amount,
            });
          } else {
            operations.transfer({
              recipient: validateAndParseAddress(action.recipient),
              amount,
            });
          }
        })
        .surplusTo(options.starknetAddress);
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
      /* Deposit pulls the deposited token out of the public balance, so it
         needs its own approval unless the deposit is STRK itself - then one
         approval covers the deposit and the fee together. Transfer and
         withdraw only ever spend the pool fee out of public STRK. */
      const strkSpend = action.type === "deposit" && isStrk ? amount + poolFee : poolFee;
      const approvals: Call[] =
        action.type === "deposit" && !isStrk
          ? [
              approvalCall(STRK_ADDRESS, poolFee, sdk.poolAddress),
              approvalCall(token, amount, sdk.poolAddress),
            ]
          : [approvalCall(STRK_ADDRESS, strkSpend, sdk.poolAddress)];
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
      const submission = await account.execute(calls, {
        nonce,
        resourceBounds,
        tip: 0n,
        ...proofDetails,
      });
      return { transaction_hash: String(submission.transaction_hash) };
    },
  };
}
