import {
  getAddress,
  padHex,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import {
  Account,
  cairo,
  constants,
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
import { readPoolFee } from "@/lib/starknet/pool-fee";
import { starknetOf, STRK_ADDRESS } from "@/lib/starknet/constants";
import { getAccountSnapshot } from "@/lib/starknet/status";

const POOL_ADDRESS = starknetOf("sepolia").pool;
const PROVER_URL = "https://transaction-prover.alpha-sepolia.sw-dev.io";
const DISCOVERY_URL = "https://discovery-service.alpha-sepolia.sw-dev.io";
const PRIVACY_RPC_URL =
  process.env.NEXT_PUBLIC_STARKNET_PRIVACY_SEPOLIA_RPC_URL ??
  "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";
const SN_CHAIN_NAME = "SN_SEPOLIA";
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

function approvalCall(amount: bigint): Call {
  const value = cairo.uint256(amount);
  return {
    contractAddress: STRK_ADDRESS,
    entrypoint: "approve",
    calldata: [POOL_ADDRESS, value.low.toString(), value.high.toString()],
  };
}

export function createEvmStrk20Account(options: {
  starknetAddress: string;
  evmAddress: string;
  evmChainId: number;
  signTypedData: SignTypedData;
}): MorokPrivateAccount {
  const provider = new RpcProvider({
    nodeUrl: PRIVACY_RPC_URL,
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
    });
    const signature = await checkedSignature(
      request as unknown as Record<string, unknown>,
    );
    viewingKey = BigInt(deriveViewingKey(signature, options.starknetAddress));
    return viewingKey;
  }

  const callSetSigner = new Eip712TypedDataSigner({
    accountAddress: options.starknetAddress,
    snChainName: SN_CHAIN_NAME,
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
      url: PROVER_URL,
      chainId: constants.StarknetChainId.SN_SEPOLIA,
      nodeUrl: PRIVACY_RPC_URL,
      ohttp: true,
    },
    discoveryProvider: { url: DISCOVERY_URL },
    poolContractAddress: POOL_ADDRESS,
  });

  const account = new Account({
    provider,
    address: options.starknetAddress,
    signer: new Eth712TransactionSigner({
      accountAddress: options.starknetAddress,
      snChainName: SN_CHAIN_NAME,
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
      if (actions.length !== 1 || actions[0]?.type !== "transfer") {
        throw new Error(
          "This Sepolia EVM session currently supports private transfers from Donate. Use EVM Lab for shield and unshield.",
        );
      }
      const action = actions[0];
      const amount = BigInt(action.amount);
      const recipient = validateAndParseAddress(action.recipient);
      const token = validateAndParseAddress(action.token);
      const latestBlock = await provider.getBlockNumber();
      const provingBlock = latestBlock - PROVING_BLOCK_DEPTH;
      const poolFee = await readPoolFee("sepolia");
      const builder = transfers
        .build({ autoSetup: true })
        .with(token, (operations) => {
          operations.transfer({ recipient, amount });
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
      const calls = [approvalCall(poolFee), callAndProof.call];
      const proofDetails = {
        proof: callAndProof.proof.data,
        proofFacts: callAndProof.proof.proofFacts,
      };
      const [nonceValue, snapshot] = await Promise.all([
        account.getNonce(),
        getAccountSnapshot(options.starknetAddress, "sepolia"),
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
        transferAmount: poolFee,
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
