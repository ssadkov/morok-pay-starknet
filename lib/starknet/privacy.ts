import { constants } from "starknet";
import type { PrivateTransfersInterface } from "@starkware-libs/starknet-privacy-sdk";

import {
  NOTE_MATURITY_BLOCKS,
  STARKNET_NETWORK,
  STARKNET_RPC_URL,
  STRK20_INDEXER_URL,
  STRK20_POOL_ADDRESS,
  STRK20_PROVING_URL,
  USDC_ADDRESS,
} from "./constants";
import { createTreasuryAccount } from "./deploy";
import type { DerivedTreasury } from "./derive";
import { createProvider } from "./status";

export type ShieldProgress =
  | "approving"
  | "waiting"
  | "proving"
  | "submitting";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function proofDetails(proof: { proofFacts?: string[]; data: string }) {
  return proof.proofFacts?.length
    ? { proofFacts: proof.proofFacts, proof: proof.data }
    : {};
}

function chainId() {
  return STARKNET_NETWORK === "mainnet"
    ? constants.StarknetChainId.SN_MAIN
    : constants.StarknetChainId.SN_SEPOLIA;
}

export async function createTreasuryTransfers(treasury: DerivedTreasury) {
  const { createPrivateTransfers } = await import(
    "@starkware-libs/starknet-privacy-sdk"
  );
  const account = createTreasuryAccount(treasury);

  return createPrivateTransfers({
    account,
    viewingKeyProvider: {
      getViewingKey: async () => treasury.viewingKey,
    },
    provingProvider: {
      url: STRK20_PROVING_URL,
      chainId: chainId(),
      nodeUrl: STARKNET_RPC_URL,
      requestTimeoutMs: 120_000,
    },
    discoveryProvider: { url: STRK20_INDEXER_URL },
    poolContractAddress: STRK20_POOL_ADDRESS,
  });
}

async function waitUntilMature(writtenBlock: number) {
  const provider = createProvider();
  const deadline = Date.now() + 180_000;

  for (;;) {
    const latest = await provider.getBlockNumber();
    if (latest - writtenBlock >= NOTE_MATURITY_BLOCKS) return;
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the approval to mature");
    }
    await sleep(2_000);
  }
}

function receiptBlockNumber(receipt: unknown): number | undefined {
  if (!receipt || typeof receipt !== "object") return undefined;
  const blockNumber = (receipt as { block_number?: number }).block_number;
  return typeof blockNumber === "number" ? blockNumber : undefined;
}

export async function discoverPrivateUsdc(
  transfers: PrivateTransfersInterface,
): Promise<bigint> {
  const { notes } = await transfers.discoverNotes({
    tokens: [BigInt(USDC_ADDRESS)],
  });
  const tokenNotes = notes.get(BigInt(USDC_ADDRESS)) ?? [];
  return tokenNotes.reduce((sum, note) => sum + note.amount, 0n);
}

export async function shieldUsdc(
  treasury: DerivedTreasury,
  amount: bigint,
  onProgress?: (step: ShieldProgress) => void,
) {
  if (amount <= BigInt(0)) {
    throw new Error("Nothing to shield");
  }

  const account = createTreasuryAccount(treasury);
  const provider = createProvider();
  const transfers = await createTreasuryTransfers(treasury);

  onProgress?.("approving");
  const approveTx = await account.execute(
    {
      contractAddress: USDC_ADDRESS,
      entrypoint: "approve",
      calldata: [STRK20_POOL_ADDRESS, amount.toString(), "0"],
    },
    { tip: BigInt(0) },
  );
  const approveReceipt = await account.provider.waitForTransaction(
    approveTx.transaction_hash,
  );
  const approveBlock =
    receiptBlockNumber(approveReceipt) ?? (await provider.getBlockNumber());

  onProgress?.("waiting");
  await waitUntilMature(approveBlock);

  onProgress?.("proving");
  const provingBlockId = (await provider.getBlockNumber()) - NOTE_MATURITY_BLOCKS;
  const { callAndProof } = await transfers
    .build({ autoRegister: true, autoSetup: true })
    .with(USDC_ADDRESS, (token) => token.deposit({ amount }))
    .surplusTo(treasury.address)
    .execute({ provingBlockId });

  onProgress?.("submitting");
  try {
    const depositTx = await account.execute(callAndProof.call, {
      tip: BigInt(0),
      ...proofDetails(callAndProof.proof),
    });
    await account.provider.waitForTransaction(depositTx.transaction_hash);
    return depositTx;
  } catch (error) {
    transfers.invalidateProofNonceCache();
    throw error;
  }
}
