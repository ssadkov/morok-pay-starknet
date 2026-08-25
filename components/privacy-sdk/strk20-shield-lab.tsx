"use client";

import { useRef, useState } from "react";
import { ExternalLinkIcon, KeyRoundIcon, RefreshCwIcon, SendIcon } from "lucide-react";
import { getAddress, padHex, recoverTypedDataAddress, type Address } from "viem";
import { useAccount, useSignTypedData } from "wagmi";
import {
  Account,
  cairo,
  constants,
  RpcError,
  RpcProvider,
  type Call,
  type ResourceBoundsBN,
} from "starknet";
import {
  createPrivateTransfers,
  SetupRequirement,
  type CallAndProof,
  type Note,
} from "@starkware-libs/starknet-privacy-sdk";
import { deriveViewingKey } from "@starkware-libs/starknet-privacy-client";
import {
  Eip712TypedDataSigner,
  type CallSetTypedData,
} from "@starkware-libs/starknet-privacy-client/signers";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { Eth712AccountInspection } from "@/lib/privacy/eth712-account";
import { eth712Strk20ClassMode } from "@/lib/privacy/eth712-account";
import {
  Eth712TransactionSigner,
  ETH712_TEST_MAXIMUM_GAS_FEE,
  eth712FundedResourceBounds,
  safeEth712TransactionError,
} from "@/lib/privacy/eth712-transaction";
import { privacyKeyTypedData } from "@/lib/privacy/eip712-test";
import { readPoolFee } from "@/lib/starknet/pool-fee";
import { starknetOf } from "@/lib/starknet/constants";
import { formatStrk } from "@/lib/starknet/status";
import {
  bounded,
  pollTransactionReceipt,
  WALLET_SUBMISSION_TIMEOUT_MS,
} from "@/lib/starknet/transaction-confirmation";

const POOL_ADDRESS =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const STRK_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const PROVER_URL = "https://transaction-prover.alpha-sepolia.sw-dev.io";
const DISCOVERY_URL = "https://discovery-service.alpha-sepolia.sw-dev.io";
const PRIVACY_RPC_URL =
  process.env.NEXT_PUBLIC_STARKNET_PRIVACY_SEPOLIA_RPC_URL ??
  "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";
const SN_CHAIN_NAME = "SN_SEPOLIA";
const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = "0x50524f4f4631";
const SHIELD_AMOUNT = 1_000_000_000_000_000_000n;

type PreparedShield = {
  accountAddress: string;
  evmAddress: string;
  evmChainId: number;
  nonce: bigint;
  provingBlock: number;
  amount: bigint;
  poolFee: bigint;
  publicBalance: bigint;
  provingBalance: bigint;
  privateBalanceBefore: bigint;
  resourceBounds: ResourceBoundsBN;
  maximumFee: bigint;
  proofBytes: number;
  proofFacts: number;
  sourceClassHash: string;
  readiness: string;
};

type ShieldPayload = {
  calls: Call[];
  proof: string;
  proofFacts: string[];
};

type PreparedUnshield = {
  accountAddress: string;
  evmAddress: string;
  evmChainId: number;
  nonce: bigint;
  provingBlock: number;
  amount: bigint;
  poolFee: bigint;
  publicBalance: bigint;
  provingBalance: bigint;
  privateBalanceBefore: bigint;
  selectedNoteCount: number;
  selectedTotal: bigint;
  resourceBounds: ResourceBoundsBN;
  maximumFee: bigint;
  proofBytes: number;
  proofFacts: number;
  sourceClassHash: string;
};

type ShieldState = {
  status: "unknown" | "pending" | "confirmed" | "failed";
  message: string;
  txHash?: string;
};

function privacyProvider() {
  return new RpcProvider({
    nodeUrl: PRIVACY_RPC_URL,
    specVersion: "0.10.3",
  });
}

function maximumFee(bounds: ResourceBoundsBN) {
  return (
    bounds.l1_gas.max_amount * bounds.l1_gas.max_price_per_unit +
    bounds.l2_gas.max_amount * bounds.l2_gas.max_price_per_unit +
    bounds.l1_data_gas.max_amount * bounds.l1_data_gas.max_price_per_unit
  );
}

function proofByteLength(proof: string) {
  const padding = proof.endsWith("==") ? 2 : proof.endsWith("=") ? 1 : 0;
  return Math.max(0, (proof.length * 3) / 4 - padding);
}

function approvalCall(amount: bigint): Call {
  const value = cairo.uint256(amount);
  return {
    contractAddress: STRK_ADDRESS,
    entrypoint: "approve",
    calldata: [POOL_ADDRESS, value.low.toString(), value.high.toString()],
  };
}

function markerKey(accountAddress: string) {
  return `morokpay:eth712-strk20-shield:sepolia:${accountAddress.toLowerCase()}`;
}

function unshieldMarkerKey(accountAddress: string) {
  return `morokpay:eth712-strk20-unshield:sepolia:${accountAddress.toLowerCase()}`;
}

function restoredShield(accountAddress: string | null): ShieldState | null {
  if (!accountAddress) return null;
  const stored = window.localStorage.getItem(markerKey(accountAddress));
  if (!stored) return null;
  try {
    const marker = JSON.parse(stored) as { status?: string; txHash?: string };
    if (marker.status === "confirmed" && marker.txHash) {
      return {
        status: "confirmed",
        txHash: marker.txHash,
        message:
          "This browser recorded a confirmed 1 STRK shield. Refresh the private balance instead of submitting it again.",
      };
    }
    return {
      status: marker.txHash ? "pending" : "unknown",
      txHash: marker.txHash,
      message: marker.txHash
        ? "A shield was already submitted. Check its hash instead of sending another one."
        : "A previous shield request did not return a hash. Check the nonce and private balance before retrying.",
    };
  } catch {
    window.localStorage.removeItem(markerKey(accountAddress));
    return null;
  }
}

function restoredUnshield(accountAddress: string | null): ShieldState | null {
  if (!accountAddress) return null;
  const stored = window.localStorage.getItem(unshieldMarkerKey(accountAddress));
  if (!stored) return null;
  try {
    const marker = JSON.parse(stored) as { status?: string; txHash?: string };
    if (marker.status === "confirmed" && marker.txHash) {
      return {
        status: "confirmed",
        txHash: marker.txHash,
        message:
          "This browser recorded a confirmed 1 STRK unshield. Refresh balances instead of submitting it again.",
      };
    }
    return {
      status: marker.txHash ? "pending" : "unknown",
      txHash: marker.txHash,
      message: marker.txHash
        ? "An unshield was already submitted. Check its hash instead of sending another one."
        : "A previous unshield did not return a hash. Check nonce and balances before retrying.",
    };
  } catch {
    window.localStorage.removeItem(unshieldMarkerKey(accountAddress));
    return null;
  }
}

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

function safePreparationError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (/user rejected|rejected the request|error code 4001/i.test(message)) {
    return "MetaMask signature request was rejected. Nothing was submitted.";
  }
  if (caught instanceof RpcError) {
    if (caught.isType("TRANSACTION_EXECUTION_ERROR")) {
      let executionError = caught.baseError.data.execution_error;
      while (typeof executionError !== "string") executionError = executionError.error;
      return `Privacy RPC 41: ${executionError.slice(0, 600)}`;
    }
    return `Privacy RPC ${caught.code}: ${String(caught.baseError.message).slice(0, 600)}`;
  }
  if (/starknet_estimateFee/i.test(message) || message.length > 800) {
    return "Sepolia could not estimate the proof-backed shield. Raw proof data is hidden.";
  }
  return message;
}

async function readStrkBalance(
  provider: RpcProvider,
  accountAddress: string,
  blockIdentifier: number | "latest" = "latest",
) {
  const result = await provider.callContract(
    {
      contractAddress: STRK_ADDRESS,
      entrypoint: "balance_of",
      calldata: [accountAddress],
    },
    blockIdentifier,
  );
  const [low = "0x0", high = "0x0"] = result;
  return BigInt(low) + (BigInt(high) << 128n);
}

function selectNotesForAmount(notes: Note[], amount: bigint) {
  const selected: Note[] = [];
  let total = 0n;
  for (const note of [...notes].sort((left, right) =>
    left.amount < right.amount ? -1 : left.amount > right.amount ? 1 : 0,
  )) {
    selected.push(note);
    total += note.amount;
    if (total >= amount) break;
  }
  return { selected, total };
}

export function Strk20ShieldLab({
  inspection,
}: {
  inspection: Eth712AccountInspection | null;
}) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const sepolia = starknetOf("sepolia");
  const accountAddress = inspection?.deployed ? inspection.starknetAddress : null;
  const compatible = inspection?.deployedClassHash
    ? eth712Strk20ClassMode(inspection.deployedClassHash) === "compatible"
    : false;
  const payload = useRef<ShieldPayload | null>(null);
  const unshieldPayload = useRef<ShieldPayload | null>(null);
  const viewingKey = useRef<{ accountAddress: string; value: bigint } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [preparingUnshield, setPreparingUnshield] = useState(false);
  const [sendingUnshield, setSendingUnshield] = useState(false);
  const [prepared, setPrepared] = useState<PreparedShield | null>(null);
  const [preparedUnshield, setPreparedUnshield] =
    useState<PreparedUnshield | null>(null);
  const [shield, setShield] = useState<ShieldState | null>(() =>
    restoredShield(accountAddress),
  );
  const [unshield, setUnshield] = useState<ShieldState | null>(() =>
    restoredUnshield(accountAddress),
  );
  const [privateBalance, setPrivateBalance] = useState<bigint | null>(null);
  const [viewingKeyReady, setViewingKeyReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unshieldError, setUnshieldError] = useState<string | null>(null);

  function callSetSigner(starknetAddress: string, evmAddress: string, evmChainId: number) {
    return new Eip712TypedDataSigner({
      accountAddress: starknetAddress,
      snChainName: SN_CHAIN_NAME,
      evmChainId,
      signTypedData: async (typedData) => {
        const normalized = viemCallSetTypedData(typedData);
        const signature = await signTypedDataAsync(normalized);
        const recovered = await recoverTypedDataAddress({ ...normalized, signature });
        if (recovered.toLowerCase() !== evmAddress.toLowerCase()) {
          throw new Error(`MetaMask signed with ${recovered}, expected ${evmAddress}.`);
        }
        return signature;
      },
    });
  }

  function outerAccount(
    provider: RpcProvider,
    starknetAddress: string,
    evmAddress: string,
    evmChainId: number,
  ) {
    return new Account({
      provider,
      address: starknetAddress,
      signer: new Eth712TransactionSigner({
        accountAddress: starknetAddress,
        snChainName: SN_CHAIN_NAME,
        evmChainId,
        signTypedData: async (typedData) => {
          const signature = await signTypedDataAsync(typedData);
          const recovered = await recoverTypedDataAddress({ ...typedData, signature });
          if (recovered.toLowerCase() !== evmAddress.toLowerCase()) {
            throw new Error(`MetaMask signed with ${recovered}, expected ${evmAddress}.`);
          }
          return signature;
        },
      }),
      cairoVersion: "1",
    });
  }

  async function getViewingKey(starknetAddress: string, evmAddress: string, evmChainId: number) {
    const current = viewingKey.current;
    if (current?.accountAddress.toLowerCase() === starknetAddress.toLowerCase()) {
      return current.value;
    }
    const request = privacyKeyTypedData({
      evmAddress: evmAddress as Address,
      evmChainId,
    });
    const signature = await signTypedDataAsync(request);
    const recovered = await recoverTypedDataAddress({ ...request, signature });
    if (recovered.toLowerCase() !== evmAddress.toLowerCase()) {
      throw new Error(`MetaMask signed with ${recovered}, expected ${evmAddress}.`);
    }
    const value = BigInt(deriveViewingKey(signature, starknetAddress));
    viewingKey.current = { accountAddress: starknetAddress, value };
    setViewingKeyReady(true);
    return value;
  }

  function transfersFor(
    starknetAddress: string,
    evmAddress: string,
    evmChainId: number,
    key: bigint,
  ) {
    return createPrivateTransfers({
      account: {
        address: starknetAddress,
        signer: callSetSigner(starknetAddress, evmAddress, evmChainId),
      },
      viewingKeyProvider: { getViewingKey: async () => key },
      provingProvider: {
        url: PROVER_URL,
        chainId: constants.StarknetChainId.SN_SEPOLIA,
        nodeUrl: PRIVACY_RPC_URL,
        ohttp: true,
      },
      discoveryProvider: { url: DISCOVERY_URL },
      poolContractAddress: POOL_ADDRESS,
    });
  }

  async function discoverPrivateBalance(
    starknetAddress: string,
    evmAddress: string,
    evmChainId: number,
    key: bigint,
  ) {
    const notes = await discoverStrkNotes(
      starknetAddress,
      evmAddress,
      evmChainId,
      key,
    );
    return notes.reduce((sum, note) => sum + note.amount, 0n);
  }

  async function discoverStrkNotes(
    starknetAddress: string,
    evmAddress: string,
    evmChainId: number,
    key: bigint,
    blockIdentifier?: number,
  ) {
    const transfers = transfersFor(starknetAddress, evmAddress, evmChainId, key);
    const discovered = await transfers.discoverNotes({
      tokens: [BigInt(STRK_ADDRESS)],
      ...(blockIdentifier === undefined ? {} : { blockIdentifier }),
    });
    return discovered.notes.get(BigInt(STRK_ADDRESS)) ?? [];
  }

  async function refreshPrivateBalance() {
    if (!accountAddress || !address || !chainId) return;
    setRefreshing(true);
    setError(null);
    try {
      const key = await getViewingKey(accountAddress, address, chainId);
      setPrivateBalance(
        await discoverPrivateBalance(accountAddress, address, chainId, key),
      );
    } catch (caught) {
      setError(safePreparationError(caught));
    } finally {
      setRefreshing(false);
    }
  }

  async function prepareShield() {
    if (!accountAddress || !address || !chainId) return;
    setPreparing(true);
    setPrepared(null);
    setShield(null);
    setError(null);
    payload.current = null;

    try {
      const provider = privacyProvider();
      const latestBlock = await provider.getBlockNumber();
      const provingBlock = latestBlock - PROVING_BLOCK_DEPTH;
      const [latestClassHash, provingClassHash, publicBalance, provingBalance] =
        await Promise.all([
          provider.getClassHashAt(accountAddress),
          provider.getClassHashAt(accountAddress, provingBlock),
          readStrkBalance(provider, accountAddress),
          readStrkBalance(provider, accountAddress, provingBlock),
        ]);
      if (
        eth712Strk20ClassMode(latestClassHash) !== "compatible" ||
        eth712Strk20ClassMode(provingClassHash) !== "compatible"
      ) {
        throw new Error("The proving block does not see the STRK20-compatible account class.");
      }

      const key = await getViewingKey(accountAddress, address, chainId);
      const transfers = transfersFor(accountAddress, address, chainId, key);
      const requirement = await transfers.discoverRequirement(
        accountAddress,
        STRK_ADDRESS,
      );
      if (requirement === SetupRequirement.Register) {
        throw new Error("Discovery does not see the confirmed STRK20 registration yet.");
      }
      const [poolFee, privateBalanceBefore] = await Promise.all([
        readPoolFee("sepolia"),
        discoverPrivateBalance(accountAddress, address, chainId, key),
      ]);
      const publicSpend = SHIELD_AMOUNT + poolFee;
      if (provingBalance < publicSpend) {
        throw new Error(
          `The proving block ${provingBlock} sees only ${formatStrk(provingBalance)} STRK. Wait until the recent top-up is at least ${PROVING_BLOCK_DEPTH} blocks old.`,
        );
      }

      const builder = transfers
        .build({ autoSetup: true })
        .with(STRK_ADDRESS, (token) => token.deposit({ amount: SHIELD_AMOUNT }))
        .surplusTo(accountAddress);
      const invocation = await builder.createProofInvocation({ provingBlockId: provingBlock });
      const result = await transfers.executeWithInvocation(invocation, provingBlock);
      const callAndProof: CallAndProof = result.callAndProof;
      if (!callAndProof.proof.proofFacts.length) {
        throw new Error("The prover returned no proof facts for the shield.");
      }
      if (BigInt(callAndProof.proof.proofFacts[0]) !== BigInt(PROOF1_VERSION)) {
        throw new Error(
          `The prover returned unsupported proof version ${callAndProof.proof.proofFacts[0]}.`,
        );
      }
      const calls = [approvalCall(publicSpend), callAndProof.call];
      const proofDetails = {
        proof: callAndProof.proof.data,
        proofFacts: callAndProof.proof.proofFacts,
      };
      const account = outerAccount(provider, accountAddress, address, chainId);
      const nonce = BigInt(await account.getNonce());
      const estimate = await account.estimateInvokeFee(calls, {
        nonce,
        skipValidate: true,
        tip: 0n,
        ...proofDetails,
      });
      const resourceBounds = eth712FundedResourceBounds({
        estimated: estimate.resourceBounds,
        publicBalance,
        transferAmount: publicSpend,
        maximumFeeCap: ETH712_TEST_MAXIMUM_GAS_FEE,
      });

      payload.current = { calls, ...proofDetails };
      setPrivateBalance(privateBalanceBefore);
      setPrepared({
        accountAddress,
        evmAddress: address,
        evmChainId: chainId,
        nonce,
        provingBlock,
        amount: SHIELD_AMOUNT,
        poolFee,
        publicBalance,
        provingBalance,
        privateBalanceBefore,
        resourceBounds,
        maximumFee: maximumFee(resourceBounds),
        proofBytes: proofByteLength(callAndProof.proof.data),
        proofFacts: callAndProof.proof.proofFacts.length,
        sourceClassHash: latestClassHash,
        readiness: SetupRequirement[requirement],
      });
    } catch (caught) {
      payload.current = null;
      setError(safePreparationError(caught));
    } finally {
      setPreparing(false);
    }
  }

  async function submitShield() {
    const transaction = payload.current;
    if (!prepared || !transaction || !accountAddress || !address || !chainId) return;
    if (
      prepared.accountAddress !== accountAddress ||
      prepared.evmAddress.toLowerCase() !== address.toLowerCase() ||
      prepared.evmChainId !== chainId
    ) {
      payload.current = null;
      setPrepared(null);
      setError("The connected wallet changed. Prepare the shield again.");
      return;
    }

    setSending(true);
    setError(null);
    const key = markerKey(accountAddress);
    window.localStorage.setItem(
      key,
      JSON.stringify({ status: "submitting", nonce: prepared.nonce.toString() }),
    );
    try {
      const provider = privacyProvider();
      const account = outerAccount(provider, accountAddress, address, chainId);
      const [currentClassHash, currentNonce] = await Promise.all([
        provider.getClassHashAt(accountAddress),
        account.getNonce(),
      ]);
      if (BigInt(currentClassHash) !== BigInt(prepared.sourceClassHash)) {
        window.localStorage.removeItem(key);
        throw new Error("The account class changed. Prepare the shield again.");
      }
      if (BigInt(currentNonce) !== prepared.nonce) {
        window.localStorage.removeItem(key);
        throw new Error("The Starknet nonce changed. Prepare the shield again.");
      }

      const submission = await bounded(
        account.execute(transaction.calls, {
          nonce: prepared.nonce,
          resourceBounds: prepared.resourceBounds,
          tip: 0n,
          proof: transaction.proof,
          proofFacts: transaction.proofFacts,
        }),
        WALLET_SUBMISSION_TIMEOUT_MS,
      );
      if (submission.status === "timed_out") {
        setShield({
          status: "unknown",
          message:
            "MetaMask did not return a hash within 90 seconds. Do not submit again; check the nonce and private balance first.",
        });
        return;
      }

      const txHash = String(submission.value.transaction_hash);
      window.localStorage.setItem(key, JSON.stringify({ status: "pending", txHash }));
      setShield({
        status: "pending",
        txHash,
        message: "The 1 STRK shield was submitted to Sepolia.",
      });
      const receipt = await pollTransactionReceipt({
        read: () => provider.getTransactionReceipt(txHash),
      });
      if (receipt === "failed") {
        window.localStorage.removeItem(key);
        setShield({ status: "failed", txHash, message: "The shield failed on Starknet." });
        return;
      }
      if (receipt === "confirmed") {
        window.localStorage.setItem(key, JSON.stringify({ status: "confirmed", txHash }));
        payload.current = null;
        setPrepared(null);
        setShield({
          status: "confirmed",
          txHash,
          message:
            "The public shield is confirmed. Discovery may need additional blocks before the 1 STRK private note appears.",
        });
        return;
      }
      setShield({
        status: "pending",
        txHash,
        message:
          "The hash is known, but the receipt is still pending. Do not submit another shield.",
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const definitelyNotSubmitted =
        /user rejected|rejected the request|error code 4001/i.test(message) ||
        /account class changed|nonce changed/i.test(message);
      if (definitelyNotSubmitted) window.localStorage.removeItem(key);
      setShield({
        status: definitelyNotSubmitted ? "failed" : "unknown",
        message: definitelyNotSubmitted
          ? /account class changed|nonce changed/i.test(message)
            ? message
            : safeEth712TransactionError(caught)
          : "The shield request failed without a reliable transaction hash. Do not submit again until the nonce and private balance are checked.",
      });
    } finally {
      setSending(false);
    }
  }

  async function prepareUnshield() {
    if (!accountAddress || !address || !chainId) return;
    setPreparingUnshield(true);
    setPreparedUnshield(null);
    setUnshield(null);
    setUnshieldError(null);
    unshieldPayload.current = null;

    try {
      const provider = privacyProvider();
      const latestBlock = await provider.getBlockNumber();
      const provingBlock = latestBlock - PROVING_BLOCK_DEPTH;
      const [latestClassHash, provingClassHash, publicBalance, provingBalance] =
        await Promise.all([
          provider.getClassHashAt(accountAddress),
          provider.getClassHashAt(accountAddress, provingBlock),
          readStrkBalance(provider, accountAddress),
          readStrkBalance(provider, accountAddress, provingBlock),
        ]);
      if (
        eth712Strk20ClassMode(latestClassHash) !== "compatible" ||
        eth712Strk20ClassMode(provingClassHash) !== "compatible"
      ) {
        throw new Error("The proving block does not see the STRK20-compatible account class.");
      }

      const key = await getViewingKey(accountAddress, address, chainId);
      const transfers = transfersFor(accountAddress, address, chainId, key);
      const [poolFee, notes] = await Promise.all([
        readPoolFee("sepolia"),
        discoverStrkNotes(accountAddress, address, chainId, key, provingBlock),
      ]);
      const privateBalanceBefore = notes.reduce(
        (sum, note) => sum + note.amount,
        0n,
      );
      const { selected, total: selectedTotal } = selectNotesForAmount(
        notes,
        SHIELD_AMOUNT,
      );
      if (selectedTotal < SHIELD_AMOUNT) {
        throw new Error(
          `The proving block ${provingBlock} sees only ${formatStrk(privateBalanceBefore)} private STRK. Wait until the shield note is at least ${PROVING_BLOCK_DEPTH} blocks old.`,
        );
      }
      if (provingBalance < poolFee) {
        throw new Error(
          `The proving block ${provingBlock} does not see enough public STRK for the ${formatStrk(poolFee)} STRK pool fee.`,
        );
      }

      const builder = transfers
        .build()
        .with(STRK_ADDRESS, (token) =>
          token
            .inputs(...selected)
            .withdraw({ recipient: accountAddress, amount: SHIELD_AMOUNT }),
        )
        .surplusTo(accountAddress);
      const invocation = await builder.createProofInvocation({ provingBlockId: provingBlock });
      const result = await transfers.executeWithInvocation(invocation, provingBlock);
      const callAndProof: CallAndProof = result.callAndProof;
      if (!callAndProof.proof.proofFacts.length) {
        throw new Error("The prover returned no proof facts for the unshield.");
      }
      if (BigInt(callAndProof.proof.proofFacts[0]) !== BigInt(PROOF1_VERSION)) {
        throw new Error(
          `The prover returned unsupported proof version ${callAndProof.proof.proofFacts[0]}.`,
        );
      }
      const calls = [approvalCall(poolFee), callAndProof.call];
      const proofDetails = {
        proof: callAndProof.proof.data,
        proofFacts: callAndProof.proof.proofFacts,
      };
      const account = outerAccount(provider, accountAddress, address, chainId);
      const nonce = BigInt(await account.getNonce());
      const estimate = await account.estimateInvokeFee(calls, {
        nonce,
        skipValidate: true,
        tip: 0n,
        ...proofDetails,
      });
      const resourceBounds = eth712FundedResourceBounds({
        estimated: estimate.resourceBounds,
        publicBalance,
        transferAmount: poolFee,
        maximumFeeCap: ETH712_TEST_MAXIMUM_GAS_FEE,
      });

      unshieldPayload.current = { calls, ...proofDetails };
      setPrivateBalance(privateBalanceBefore);
      setPreparedUnshield({
        accountAddress,
        evmAddress: address,
        evmChainId: chainId,
        nonce,
        provingBlock,
        amount: SHIELD_AMOUNT,
        poolFee,
        publicBalance,
        provingBalance,
        privateBalanceBefore,
        selectedNoteCount: selected.length,
        selectedTotal,
        resourceBounds,
        maximumFee: maximumFee(resourceBounds),
        proofBytes: proofByteLength(callAndProof.proof.data),
        proofFacts: callAndProof.proof.proofFacts.length,
        sourceClassHash: latestClassHash,
      });
    } catch (caught) {
      unshieldPayload.current = null;
      setUnshieldError(safePreparationError(caught));
    } finally {
      setPreparingUnshield(false);
    }
  }

  async function submitUnshield() {
    const transaction = unshieldPayload.current;
    if (
      !preparedUnshield ||
      !transaction ||
      !accountAddress ||
      !address ||
      !chainId
    ) {
      return;
    }
    if (
      preparedUnshield.accountAddress !== accountAddress ||
      preparedUnshield.evmAddress.toLowerCase() !== address.toLowerCase() ||
      preparedUnshield.evmChainId !== chainId
    ) {
      unshieldPayload.current = null;
      setPreparedUnshield(null);
      setUnshieldError("The connected wallet changed. Prepare the unshield again.");
      return;
    }

    setSendingUnshield(true);
    setUnshieldError(null);
    const key = unshieldMarkerKey(accountAddress);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        status: "submitting",
        nonce: preparedUnshield.nonce.toString(),
      }),
    );
    try {
      const provider = privacyProvider();
      const account = outerAccount(provider, accountAddress, address, chainId);
      const [currentClassHash, currentNonce] = await Promise.all([
        provider.getClassHashAt(accountAddress),
        account.getNonce(),
      ]);
      if (BigInt(currentClassHash) !== BigInt(preparedUnshield.sourceClassHash)) {
        window.localStorage.removeItem(key);
        throw new Error("The account class changed. Prepare the unshield again.");
      }
      if (BigInt(currentNonce) !== preparedUnshield.nonce) {
        window.localStorage.removeItem(key);
        throw new Error("The Starknet nonce changed. Prepare the unshield again.");
      }

      const submission = await bounded(
        account.execute(transaction.calls, {
          nonce: preparedUnshield.nonce,
          resourceBounds: preparedUnshield.resourceBounds,
          tip: 0n,
          proof: transaction.proof,
          proofFacts: transaction.proofFacts,
        }),
        WALLET_SUBMISSION_TIMEOUT_MS,
      );
      if (submission.status === "timed_out") {
        setUnshield({
          status: "unknown",
          message:
            "MetaMask did not return a hash within 90 seconds. Do not submit again; check nonce and balances first.",
        });
        return;
      }

      const txHash = String(submission.value.transaction_hash);
      window.localStorage.setItem(key, JSON.stringify({ status: "pending", txHash }));
      setUnshield({
        status: "pending",
        txHash,
        message: "The 1 STRK unshield was submitted to Sepolia.",
      });
      const receipt = await pollTransactionReceipt({
        read: () => provider.getTransactionReceipt(txHash),
      });
      if (receipt === "failed") {
        window.localStorage.removeItem(key);
        setUnshield({
          status: "failed",
          txHash,
          message: "The unshield failed on Starknet.",
        });
        return;
      }
      if (receipt === "confirmed") {
        window.localStorage.setItem(key, JSON.stringify({ status: "confirmed", txHash }));
        unshieldPayload.current = null;
        setPreparedUnshield(null);
        setUnshield({
          status: "confirmed",
          txHash,
          message:
            "The public unshield is confirmed. Discovery may need additional blocks before the spent note disappears.",
        });
        return;
      }
      setUnshield({
        status: "pending",
        txHash,
        message:
          "The hash is known, but the receipt is still pending. Do not submit another unshield.",
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const definitelyNotSubmitted =
        /user rejected|rejected the request|error code 4001/i.test(message) ||
        /account class changed|nonce changed/i.test(message);
      if (definitelyNotSubmitted) window.localStorage.removeItem(key);
      setUnshield({
        status: definitelyNotSubmitted ? "failed" : "unknown",
        message: definitelyNotSubmitted
          ? /account class changed|nonce changed/i.test(message)
            ? message
            : safeEth712TransactionError(caught)
          : "The unshield failed without a reliable transaction hash. Do not submit again until nonce and balances are checked.",
      });
    } finally {
      setSendingUnshield(false);
    }
  }

  if (!compatible) return null;

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>8. Shield 1 STRK with MetaMask</CardTitle>
        <CardDescription>
          Deposit public STRK into a private note owned by the deterministic account.
          Preparation signs and proves; the final button broadcasts one public InvokeV3.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Public account</p>
            <p className="break-all font-mono font-medium">{accountAddress}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Shield amount</p>
            <p className="font-medium">1 STRK</p>
          </div>
          <div>
            <p className="text-muted-foreground">Private STRK balance</p>
            <p className="font-medium">
              {privateBalance === null ? "Not read in this tab" : `${formatStrk(privateBalance)} STRK`}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Viewing key</p>
            <p className="font-medium">
              {viewingKeyReady ? "Derived in tab memory" : "Not connected in this tab"}
            </p>
          </div>
        </div>

        <Alert>
          <AlertTitle>Public edge, private result</AlertTitle>
          <AlertDescription>
            The account, token, deposited amount, pool fee, and transaction timing are public.
            After confirmation, STRK20 discovery should expose a private note to this viewing key.
          </AlertDescription>
        </Alert>

        {prepared ? (
          <Alert>
            <AlertTitle>Real shield proof ready — review before broadcast</AlertTitle>
            <AlertDescription className="grid gap-1">
              <span>Public balance: {formatStrk(prepared.publicBalance)} STRK</span>
              <span>Proving-block balance: {formatStrk(prepared.provingBalance)} STRK</span>
              <span>Private balance before: {formatStrk(prepared.privateBalanceBefore)} STRK</span>
              <span>Shield amount: {formatStrk(prepared.amount)} STRK</span>
              <span>Pool fee: {formatStrk(prepared.poolFee)} STRK</span>
              <span>Balance-bounded maximum gas cap: {formatStrk(prepared.maximumFee)} STRK</span>
              <span>Nonce: {prepared.nonce.toString()}</span>
              <span>Proving block: {prepared.provingBlock}</span>
              <span>Discovery readiness: {prepared.readiness}</span>
              <span>
                Proof: {prepared.proofBytes.toLocaleString()} bytes · {prepared.proofFacts} fact(s)
              </span>
              <span>
                One InvokeV3 approves exactly shield amount plus pool fee, then batches any
                missing self-channel/token setup with the proof-backed deposit. The pool fee is
                charged once for the shared apply_actions call. Starknet charges actual gas, not
                the full cap.
              </span>
            </AlertDescription>
          </Alert>
        ) : null}

        {shield ? (
          <Alert variant={shield.status === "failed" ? "destructive" : "default"}>
            <AlertTitle>STRK shield {shield.status}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{shield.message}</span>
              {shield.txHash ? (
                <a
                  href={`${sepolia.explorer}/tx/${shield.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all font-mono underline underline-offset-4"
                >
                  {shield.txHash}
                  <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Shield preparation stopped</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!accountAddress || !address || !chainId || refreshing || preparing || sending}
          onClick={() => void refreshPrivateBalance()}
        >
          {refreshing ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          {refreshing ? "Discovering notes" : "Refresh private balance"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={
            !accountAddress ||
            !address ||
            !chainId ||
            preparing ||
            sending ||
            (!!shield && shield.status !== "failed")
          }
          onClick={() => void prepareShield()}
        >
          {preparing ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
          {preparing ? "Signing and proving" : "Prepare 1 STRK shield"}
        </Button>
        <Button
          type="button"
          disabled={!prepared || preparing || sending || !!shield}
          onClick={() => void submitShield()}
        >
          {sending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
          {sending ? "Waiting for MetaMask" : "Sign and shield on Sepolia"}
        </Button>
      </CardFooter>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle>9. Unshield 1 STRK with MetaMask</CardTitle>
        <CardDescription>
          Spend the discovered private note and withdraw 1 STRK back to the same public
          Starknet account. Preparation creates a real proof; broadcast remains separate.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Private STRK available</p>
            <p className="font-medium">
              {privateBalance === null ? "Refresh first" : `${formatStrk(privateBalance)} STRK`}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Public recipient</p>
            <p className="break-all font-mono font-medium">{accountAddress}</p>
          </div>
        </div>

        <Alert>
          <AlertTitle>Unshield is public</AlertTitle>
          <AlertDescription>
            The recipient, token, amount, pool fee, and timing will be visible on-chain. The
            selected private note is proven as spent; discovery should later remove it.
          </AlertDescription>
        </Alert>

        {preparedUnshield ? (
          <Alert>
            <AlertTitle>Real unshield proof ready — review before broadcast</AlertTitle>
            <AlertDescription className="grid gap-1">
              <span>Public balance: {formatStrk(preparedUnshield.publicBalance)} STRK</span>
              <span>
                Proving-block public balance: {formatStrk(preparedUnshield.provingBalance)} STRK
              </span>
              <span>
                Private balance before: {formatStrk(preparedUnshield.privateBalanceBefore)} STRK
              </span>
              <span>Unshield amount: {formatStrk(preparedUnshield.amount)} STRK</span>
              <span>
                Expected private change: {formatStrk(preparedUnshield.selectedTotal - preparedUnshield.amount)} STRK
              </span>
              <span>
                Selected notes: {preparedUnshield.selectedNoteCount} · {formatStrk(preparedUnshield.selectedTotal)} STRK
              </span>
              <span>Pool fee: {formatStrk(preparedUnshield.poolFee)} STRK</span>
              <span>
                Balance-bounded maximum gas cap: {formatStrk(preparedUnshield.maximumFee)} STRK
              </span>
              <span>Nonce: {preparedUnshield.nonce.toString()}</span>
              <span>Proving block: {preparedUnshield.provingBlock}</span>
              <span>
                Proof: {preparedUnshield.proofBytes.toLocaleString()} bytes · {preparedUnshield.proofFacts} fact(s)
              </span>
              <span>
                One InvokeV3 approves only the pool fee, then applies the proof-backed
                withdrawal. Gas is paid separately by this public account.
              </span>
            </AlertDescription>
          </Alert>
        ) : null}

        {unshield ? (
          <Alert variant={unshield.status === "failed" ? "destructive" : "default"}>
            <AlertTitle>STRK unshield {unshield.status}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{unshield.message}</span>
              {unshield.txHash ? (
                <a
                  href={`${sepolia.explorer}/tx/${unshield.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all font-mono underline underline-offset-4"
                >
                  {unshield.txHash}
                  <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {unshieldError ? (
          <Alert variant="destructive">
            <AlertTitle>Unshield preparation stopped</AlertTitle>
            <AlertDescription>{unshieldError}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={
            !accountAddress ||
            !address ||
            !chainId ||
            privateBalance === null ||
            privateBalance < SHIELD_AMOUNT ||
            preparingUnshield ||
            sendingUnshield ||
            (!!unshield && unshield.status !== "failed")
          }
          onClick={() => void prepareUnshield()}
        >
          {preparingUnshield ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <KeyRoundIcon data-icon="inline-start" />
          )}
          {preparingUnshield ? "Signing and proving" : "Prepare 1 STRK unshield"}
        </Button>
        <Button
          type="button"
          disabled={
            !preparedUnshield ||
            preparingUnshield ||
            sendingUnshield ||
            !!unshield
          }
          onClick={() => void submitUnshield()}
        >
          {sendingUnshield ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <SendIcon data-icon="inline-start" />
          )}
          {sendingUnshield ? "Waiting for MetaMask" : "Sign and unshield on Sepolia"}
        </Button>
      </CardFooter>
    </Card>
    </>
  );
}
