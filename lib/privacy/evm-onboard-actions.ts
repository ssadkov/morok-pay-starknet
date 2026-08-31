import { getAddress, padHex, recoverTypedDataAddress, type Hex } from "viem";
import { Account, cairo, RpcProvider, type Call } from "starknet";
import {
  createPrivateTransfers,
  SetupRequirement,
  type CallAndProof,
} from "@starkware-libs/starknet-privacy-sdk";
import { deriveViewingKey } from "@starkware-libs/starknet-privacy-client";
import {
  Eip712TypedDataSigner,
  type CallSetTypedData,
} from "@starkware-libs/starknet-privacy-client/signers";

import type { AppNetwork } from "@/lib/network";
import { eth712Strk20ClassMode } from "@/lib/privacy/eth712-account";
import { privacyKeyTypedData } from "@/lib/privacy/eip712-test";
import { privacySdkOf, type PrivacySdkNetwork } from "@/lib/privacy/network";
import {
  Eth712TransactionSigner,
  ETH712_TEST_MAXIMUM_GAS_FEE,
  eth712FundedResourceBounds,
} from "@/lib/privacy/eth712-transaction";
import { readPoolFee } from "@/lib/starknet/pool-fee";
import { STRK_ADDRESS } from "@/lib/starknet/constants";
import { getAccountSnapshot } from "@/lib/starknet/status";

/**
 * The registration half of EVM onboarding, lifted out of
 * components/privacy-sdk/strk20-registration-lab.tsx so the product flow and
 * the diagnostic lab run the same code rather than two drifting copies.
 *
 * The lab still owns the step-by-step presentation - separate prepare and
 * submit buttons, proof sizes, resource bounds on screen. This is the same
 * sequence with one entry point, for a user who wants an account rather than a
 * readout.
 */

/* The proof is built against a block behind the head, so a freshly deployed
   account is invisible to the prover for roughly this many blocks. */
export const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = BigInt("0x50524f4f4631");

export type OnboardProgress = (step: string) => void;

function viemCallSetTypedData(typedData: CallSetTypedData) {
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

function approvalCall(amount: bigint, poolAddress: string): Call {
  const value = cairo.uint256(amount);
  return {
    contractAddress: STRK_ADDRESS,
    entrypoint: "approve",
    calldata: [poolAddress, value.low.toString(), value.high.toString()],
  };
}

function privacyProvider(sdk: PrivacySdkNetwork) {
  return new RpcProvider({ nodeUrl: sdk.privacyRpcUrl, specVersion: "0.10.3" });
}

/**
 * Is the account visible to the prover yet? A deploy that just confirmed is
 * not: the proving block trails the head, and registration against a block
 * that predates the deployment reverts with "not deployed".
 */
export async function provingBlockSeesAccount(
  network: AppNetwork,
  accountAddress: string,
): Promise<boolean> {
  const provider = privacyProvider(privacySdkOf(network));
  const head = await provider.getBlockNumber();
  try {
    const classHash = await provider.getClassHashAt(
      accountAddress,
      head - PROVING_BLOCK_DEPTH,
    );
    return eth712Strk20ClassMode(classHash) === "compatible";
  } catch {
    return false;
  }
}

export type RegisterResult =
  | { status: "already_registered" }
  | { status: "submitted"; transactionHash: string };

/**
 * Derives the viewing key, obtains a real proof, and submits the account's own
 * registration InvokeV3. Two wallet confirmations to prepare, a third to send.
 */
export async function registerEvmAccount(args: {
  network: AppNetwork;
  accountAddress: string;
  evmAddress: string;
  evmChainId: number;
  signTypedData: (typedData: Record<string, unknown>) => Promise<Hex>;
  onProgress?: OnboardProgress;
}): Promise<RegisterResult> {
  const { network, accountAddress, evmAddress, evmChainId } = args;
  const sdk = privacySdkOf(network);
  const provider = privacyProvider(sdk);
  const progress = args.onProgress ?? (() => {});

  async function checkedSign(typedData: Record<string, unknown>) {
    const signature = await args.signTypedData(typedData);
    const recovered = await recoverTypedDataAddress({
      ...(typedData as Parameters<typeof recoverTypedDataAddress>[0]),
      signature,
    });
    if (recovered.toLowerCase() !== evmAddress.toLowerCase()) {
      throw new Error(`The wallet signed with ${recovered}, expected ${evmAddress}.`);
    }
    return signature;
  }

  const head = await provider.getBlockNumber();
  const provingBlock = head - PROVING_BLOCK_DEPTH;
  const provingClassHash = await provider
    .getClassHashAt(accountAddress, provingBlock)
    .catch(() => null);
  if (!provingClassHash || eth712Strk20ClassMode(provingClassHash) !== "compatible") {
    throw new Error(
      `The network has not caught up with the new account yet. Wait about ${PROVING_BLOCK_DEPTH} blocks after deployment and try again.`,
    );
  }

  progress("Confirm the viewing-key signature in your wallet");
  /* No evmChainId: the viewing key is pinned to a fixed one so it does not
     change with whatever network the wallet is on. */
  const keyRequest = privacyKeyTypedData({
    evmAddress: evmAddress as `0x${string}`,
    starknetChain: sdk.snChainName,
    privacyPool: BigInt(sdk.poolAddress),
    accountFactory: BigInt(sdk.accountFactory),
  });
  const keySignature = await checkedSign(
    keyRequest as unknown as Record<string, unknown>,
  );
  const viewingKey = BigInt(deriveViewingKey(keySignature, accountAddress));

  const callSetSigner = new Eip712TypedDataSigner({
    accountAddress,
    snChainName: sdk.snChainName,
    evmChainId,
    signTypedData: async (typedData) =>
      checkedSign(
        viemCallSetTypedData(typedData) as unknown as Record<string, unknown>,
      ),
  });

  const transfers = createPrivateTransfers({
    account: { address: accountAddress, signer: callSetSigner },
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider: {
      url: sdk.proverUrl,
      chainId: sdk.starknetChainId,
      nodeUrl: sdk.privacyRpcUrl,
      ohttp: true,
    },
    discoveryProvider: { url: sdk.discoveryUrl },
    poolContractAddress: sdk.poolAddress,
  });

  const requirement = await transfers.discoverRequirement(
    accountAddress,
    STRK_ADDRESS,
  );
  if (requirement !== SetupRequirement.Register) {
    return { status: "already_registered" };
  }

  progress("Building the privacy proof");
  const invocation = await transfers
    .build()
    .register()
    .createProofInvocation({ provingBlockId: provingBlock });
  const result = await transfers.executeWithInvocation(invocation, provingBlock);
  const callAndProof: CallAndProof = result.callAndProof;
  if (
    !callAndProof.proof.proofFacts.length ||
    BigInt(callAndProof.proof.proofFacts[0]) !== PROOF1_VERSION
  ) {
    throw new Error("The prover returned an unsupported proof. Nothing was submitted.");
  }

  const [poolFee, snapshot] = await Promise.all([
    readPoolFee(network),
    getAccountSnapshot(accountAddress, network),
  ]);

  const account = new Account({
    provider,
    address: accountAddress,
    signer: new Eth712TransactionSigner({
      accountAddress,
      snChainName: sdk.snChainName,
      evmChainId,
      signTypedData: async (typedData) =>
        checkedSign(typedData as unknown as Record<string, unknown>),
    }),
    cairoVersion: "1",
  });

  const calls = [approvalCall(poolFee, sdk.poolAddress), callAndProof.call];
  const proofDetails = {
    proof: callAndProof.proof.data,
    proofFacts: callAndProof.proof.proofFacts,
  };
  const nonce = BigInt(await account.getNonce());
  const estimate = await account.estimateInvokeFee(calls, {
    nonce,
    skipValidate: true,
    tip: BigInt(0),
    ...proofDetails,
  });
  const resourceBounds = eth712FundedResourceBounds({
    estimated: estimate.resourceBounds,
    publicBalance: snapshot.strkWei,
    transferAmount: poolFee,
    maximumFeeCap: ETH712_TEST_MAXIMUM_GAS_FEE,
  });

  progress("Confirm the registration transaction in your wallet");
  const submission = await account.execute(calls, {
    nonce,
    resourceBounds,
    tip: BigInt(0),
    ...proofDetails,
  });
  return {
    status: "submitted",
    transactionHash: String(submission.transaction_hash),
  };
}
