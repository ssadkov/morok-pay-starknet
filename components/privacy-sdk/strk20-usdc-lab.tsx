"use client";

import { useRef, useState } from "react";
import { ExternalLinkIcon, KeyRoundIcon, RefreshCwIcon, SendIcon } from "lucide-react";
import {
  formatUnits,
  getAddress,
  padHex,
  parseUnits,
  recoverTypedDataAddress,
  type Address,
} from "viem";
import { useAccount, useSignTypedData } from "wagmi";
import {
  Account,
  cairo,
  constants,
  RpcError,
  RpcProvider,
  validateAndParseAddress,
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
import { Input } from "@/components/ui/input";
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

const SEPOLIA = starknetOf("sepolia");
const USDC_ADDRESS = SEPOLIA.usdc;
const STRK_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const POOL_ADDRESS = SEPOLIA.pool;
const PROVER_URL = "https://transaction-prover.alpha-sepolia.sw-dev.io";
const DISCOVERY_URL = "https://discovery-service.alpha-sepolia.sw-dev.io";
const PRIVACY_RPC_URL =
  process.env.NEXT_PUBLIC_STARKNET_PRIVACY_SEPOLIA_RPC_URL ??
  "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";
const SN_CHAIN_NAME = "SN_SEPOLIA";
const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = "0x50524f4f4631";
const USDC_DECIMALS = 6;

type UsdcOperation = "shield" | "transfer" | "unshield";

type PreparedUsdcOperation = {
  operation: UsdcOperation;
  accountAddress: string;
  evmAddress: string;
  evmChainId: number;
  nonce: bigint;
  provingBlock: number;
  amount: bigint;
  recipient: string;
  readiness: string | null;
  poolFee: bigint;
  publicStrk: bigint;
  publicUsdc: bigint;
  provingUsdc: bigint;
  privateUsdcBefore: bigint;
  selectedNoteCount: number;
  selectedTotal: bigint;
  resourceBounds: ResourceBoundsBN;
  maximumFee: bigint;
  proofBytes: number;
  proofFacts: number;
  sourceClassHash: string;
};

type UsdcPayload = {
  calls: Call[];
  proof: string;
  proofFacts: string[];
};

type OperationState = {
  status: "unknown" | "pending" | "confirmed" | "failed";
  operation: UsdcOperation;
  message: string;
  txHash?: string;
};

function privacyProvider() {
  return new RpcProvider({
    nodeUrl: PRIVACY_RPC_URL,
    specVersion: "0.10.3",
  });
}

function operationLabel(operation: UsdcOperation) {
  if (operation === "shield") return "Shield";
  if (operation === "transfer") return "Private transfer";
  return "Unshield";
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

function approvalCall(token: string, amount: bigint): Call {
  const value = cairo.uint256(amount);
  return {
    contractAddress: token,
    entrypoint: "approve",
    calldata: [POOL_ADDRESS, value.low.toString(), value.high.toString()],
  };
}

function markerKey(accountAddress: string, operation: UsdcOperation) {
  return `morokpay:eth712-strk20-usdc:${operation}:sepolia:${accountAddress.toLowerCase()}`;
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
    return "Sepolia could not estimate the proof-backed USDC operation. Raw proof data is hidden.";
  }
  return message;
}

async function readTokenBalance(
  provider: RpcProvider,
  token: string,
  accountAddress: string,
  blockIdentifier: number | "latest" = "latest",
) {
  const result = await provider.callContract(
    {
      contractAddress: token,
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

function formatUsdc(amount: bigint) {
  return formatUnits(amount, USDC_DECIMALS);
}

export function Strk20UsdcLab({
  inspection,
}: {
  inspection: Eth712AccountInspection | null;
}) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const accountAddress = inspection?.deployed ? inspection.starknetAddress : null;
  const compatible = inspection?.deployedClassHash
    ? eth712Strk20ClassMode(inspection.deployedClassHash) === "compatible"
    : false;
  const payload = useRef<UsdcPayload | null>(null);
  const viewingKey = useRef<{ accountAddress: string; value: bigint } | null>(null);
  const [amountInput, setAmountInput] = useState("1");
  const [recipientInput, setRecipientInput] = useState("");
  const [publicUsdc, setPublicUsdc] = useState<bigint | null>(null);
  const [privateUsdc, setPrivateUsdc] = useState<bigint | null>(null);
  const [viewingKeyReady, setViewingKeyReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [preparing, setPreparing] = useState<UsdcOperation | null>(null);
  const [sending, setSending] = useState(false);
  const [prepared, setPrepared] = useState<PreparedUsdcOperation | null>(null);
  const [operationState, setOperationState] = useState<OperationState | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function discoverUsdcNotes(
    starknetAddress: string,
    evmAddress: string,
    evmChainId: number,
    key: bigint,
    blockIdentifier?: number,
  ) {
    const transfers = transfersFor(starknetAddress, evmAddress, evmChainId, key);
    const discovered = await transfers.discoverNotes({
      tokens: [BigInt(USDC_ADDRESS)],
      ...(blockIdentifier === undefined ? {} : { blockIdentifier }),
    });
    return discovered.notes.get(BigInt(USDC_ADDRESS)) ?? [];
  }

  async function refreshBalances() {
    if (!accountAddress || !address || !chainId) return;
    setRefreshing(true);
    setError(null);
    try {
      const provider = privacyProvider();
      const key = await getViewingKey(accountAddress, address, chainId);
      const [nextPublic, notes] = await Promise.all([
        readTokenBalance(provider, USDC_ADDRESS, accountAddress),
        discoverUsdcNotes(accountAddress, address, chainId, key),
      ]);
      setPublicUsdc(nextPublic);
      setPrivateUsdc(notes.reduce((sum, note) => sum + note.amount, 0n));
    } catch (caught) {
      setError(safePreparationError(caught));
    } finally {
      setRefreshing(false);
    }
  }

  function parseAmount() {
    const value = amountInput.trim();
    if (!/^\d+(\.\d{1,6})?$/.test(value)) {
      throw new Error("Enter a positive USDC amount with at most 6 decimal places.");
    }
    const amount = parseUnits(value, USDC_DECIMALS);
    if (amount <= 0n) throw new Error("USDC amount must be greater than zero.");
    return amount;
  }

  async function prepareOperation(operation: UsdcOperation) {
    if (!accountAddress || !address || !chainId) return;
    setPreparing(operation);
    setPrepared(null);
    setOperationState(null);
    setError(null);
    payload.current = null;

    try {
      const stored = window.localStorage.getItem(markerKey(accountAddress, operation));
      if (stored) {
        const marker = JSON.parse(stored) as { status?: string; txHash?: string };
        if (marker.status === "submitting" || marker.status === "pending") {
          throw new Error(
            marker.txHash
              ? `A ${operation} is already pending at ${marker.txHash}. Do not submit another one.`
              : `A previous ${operation} returned no hash. Check nonce and balances before retrying.`,
          );
        }
      }

      const amount = parseAmount();
      const recipient =
        operation === "transfer"
          ? validateAndParseAddress(recipientInput.trim())
          : accountAddress;
      const provider = privacyProvider();
      const latestBlock = await provider.getBlockNumber();
      const provingBlock = latestBlock - PROVING_BLOCK_DEPTH;
      const [latestClassHash, provingClassHash, publicStrk, nextPublicUsdc, provingUsdc] =
        await Promise.all([
          provider.getClassHashAt(accountAddress),
          provider.getClassHashAt(accountAddress, provingBlock),
          readTokenBalance(provider, STRK_ADDRESS, accountAddress),
          readTokenBalance(provider, USDC_ADDRESS, accountAddress),
          readTokenBalance(provider, USDC_ADDRESS, accountAddress, provingBlock),
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
        discoverUsdcNotes(accountAddress, address, chainId, key, provingBlock),
      ]);
      const privateUsdcBefore = notes.reduce((sum, note) => sum + note.amount, 0n);
      let selected: Note[] = [];
      let selectedTotal = 0n;
      let readiness: string | null = null;

      if (operation === "shield") {
        if (provingUsdc < amount) {
          throw new Error(
            `The proving block ${provingBlock} sees only ${formatUsdc(provingUsdc)} public USDC. Wait until funding is at least ${PROVING_BLOCK_DEPTH} blocks old.`,
          );
        }
      } else {
        ({ selected, total: selectedTotal } = selectNotesForAmount(notes, amount));
        if (selectedTotal < amount) {
          throw new Error(
            `The proving block ${provingBlock} sees only ${formatUsdc(privateUsdcBefore)} private USDC.`,
          );
        }
      }

      if (operation === "transfer") {
        const requirement = await transfers.discoverRequirement(recipient, USDC_ADDRESS);
        if (requirement === SetupRequirement.Register) {
          throw new Error("The private-transfer recipient is not registered in STRK20.");
        }
        readiness = SetupRequirement[requirement];
      }

      let builder = transfers.build({ autoSetup: operation !== "unshield" });
      if (operation === "shield") {
        builder = builder
          .with(USDC_ADDRESS, (token) => token.deposit({ amount }))
          .surplusTo(accountAddress);
      } else if (operation === "transfer") {
        builder = builder
          .with(USDC_ADDRESS, (token) =>
            token.inputs(...selected).transfer({ recipient, amount }),
          )
          .surplusTo(accountAddress);
      } else {
        builder = builder
          .with(USDC_ADDRESS, (token) =>
            token.inputs(...selected).withdraw({ recipient: accountAddress, amount }),
          )
          .surplusTo(accountAddress);
      }

      const invocation = await builder.createProofInvocation({ provingBlockId: provingBlock });
      const result = await transfers.executeWithInvocation(invocation, provingBlock);
      const callAndProof: CallAndProof = result.callAndProof;
      if (!callAndProof.proof.proofFacts.length) {
        throw new Error("The prover returned no proof facts for the USDC operation.");
      }
      if (BigInt(callAndProof.proof.proofFacts[0]) !== BigInt(PROOF1_VERSION)) {
        throw new Error(
          `The prover returned unsupported proof version ${callAndProof.proof.proofFacts[0]}.`,
        );
      }

      const calls =
        operation === "shield"
          ? [
              approvalCall(USDC_ADDRESS, amount),
              approvalCall(STRK_ADDRESS, poolFee),
              callAndProof.call,
            ]
          : [approvalCall(STRK_ADDRESS, poolFee), callAndProof.call];
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
        publicBalance: publicStrk,
        transferAmount: poolFee,
        maximumFeeCap: ETH712_TEST_MAXIMUM_GAS_FEE,
      });

      payload.current = { calls, ...proofDetails };
      setPublicUsdc(nextPublicUsdc);
      setPrivateUsdc(privateUsdcBefore);
      setPrepared({
        operation,
        accountAddress,
        evmAddress: address,
        evmChainId: chainId,
        nonce,
        provingBlock,
        amount,
        recipient,
        readiness,
        poolFee,
        publicStrk,
        publicUsdc: nextPublicUsdc,
        provingUsdc,
        privateUsdcBefore,
        selectedNoteCount: selected.length,
        selectedTotal,
        resourceBounds,
        maximumFee: maximumFee(resourceBounds),
        proofBytes: proofByteLength(callAndProof.proof.data),
        proofFacts: callAndProof.proof.proofFacts.length,
        sourceClassHash: latestClassHash,
      });
    } catch (caught) {
      payload.current = null;
      setError(safePreparationError(caught));
    } finally {
      setPreparing(null);
    }
  }

  async function submitPrepared() {
    const transaction = payload.current;
    if (!prepared || !transaction || !accountAddress || !address || !chainId) return;
    if (
      prepared.accountAddress !== accountAddress ||
      prepared.evmAddress.toLowerCase() !== address.toLowerCase() ||
      prepared.evmChainId !== chainId
    ) {
      payload.current = null;
      setPrepared(null);
      setError("The connected wallet changed. Prepare the USDC operation again.");
      return;
    }

    setSending(true);
    setError(null);
    const key = markerKey(accountAddress, prepared.operation);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        status: "submitting",
        nonce: prepared.nonce.toString(),
      }),
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
        throw new Error("The account class changed. Prepare the USDC operation again.");
      }
      if (BigInt(currentNonce) !== prepared.nonce) {
        window.localStorage.removeItem(key);
        throw new Error("The Starknet nonce changed. Prepare the USDC operation again.");
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
        setOperationState({
          status: "unknown",
          operation: prepared.operation,
          message:
            "MetaMask did not return a hash within 90 seconds. Do not submit again; check nonce and balances first.",
        });
        return;
      }

      const txHash = String(submission.value.transaction_hash);
      window.localStorage.setItem(key, JSON.stringify({ status: "pending", txHash }));
      setOperationState({
        status: "pending",
        operation: prepared.operation,
        txHash,
        message: `${operationLabel(prepared.operation)} USDC was submitted to Sepolia.`,
      });
      const receipt = await pollTransactionReceipt({
        read: () => provider.getTransactionReceipt(txHash),
      });
      if (receipt === "failed") {
        window.localStorage.removeItem(key);
        setOperationState({
          status: "failed",
          operation: prepared.operation,
          txHash,
          message: `${operationLabel(prepared.operation)} USDC failed on Starknet.`,
        });
        return;
      }
      if (receipt === "confirmed") {
        window.localStorage.setItem(key, JSON.stringify({ status: "confirmed", txHash }));
        payload.current = null;
        setPrepared(null);
        setOperationState({
          status: "confirmed",
          operation: prepared.operation,
          txHash,
          message:
            "The public transaction is confirmed. Refresh after discovery indexes the resulting private state.",
        });
        return;
      }
      setOperationState({
        status: "pending",
        operation: prepared.operation,
        txHash,
        message: "The hash is known, but its receipt is still pending. Do not resubmit.",
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const definitelyNotSubmitted =
        /user rejected|rejected the request|error code 4001/i.test(message) ||
        /account class changed|nonce changed/i.test(message);
      if (definitelyNotSubmitted) window.localStorage.removeItem(key);
      setOperationState({
        status: definitelyNotSubmitted ? "failed" : "unknown",
        operation: prepared.operation,
        message: definitelyNotSubmitted
          ? /account class changed|nonce changed/i.test(message)
            ? message
            : safeEth712TransactionError(caught)
          : "The request failed without a reliable hash. Do not submit again until nonce and balances are checked.",
      });
    } finally {
      setSending(false);
    }
  }

  if (!compatible) return null;

  const busy = refreshing || preparing !== null || sending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>10. Private USDC with MetaMask</CardTitle>
        <CardDescription>
          Prepare numeric USDC shield, private transfer, and unshield operations. Every
          broadcast is a separate MetaMask confirmation and pays pool fee plus gas in STRK.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Public USDC</p>
            <p className="font-medium">
              {publicUsdc === null ? "Not read" : `${formatUsdc(publicUsdc)} USDC`}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Private USDC</p>
            <p className="font-medium">
              {privateUsdc === null ? "Not read" : `${formatUsdc(privateUsdc)} USDC`}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">USDC token</p>
            <p className="break-all font-mono font-medium">{USDC_ADDRESS}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Viewing key</p>
            <p className="font-medium">
              {viewingKeyReady ? "Derived in tab memory" : "Not connected in this tab"}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Amount, USDC</span>
            <Input
              inputMode="decimal"
              value={amountInput}
              disabled={busy}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder="1.25"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Private transfer recipient</span>
            <Input
              value={recipientInput}
              disabled={busy}
              onChange={(event) => setRecipientInput(event.target.value)}
              placeholder="0x… registered Starknet account"
            />
          </label>
        </div>

        <Alert>
          <AlertTitle>Token amount and protocol costs are separate</AlertTitle>
          <AlertDescription>
            USDC uses 6 decimals. Shield approves only the entered USDC amount. All three
            operations approve the current pool fee in public STRK and pay Starknet gas from
            the public account; the maximum gas cap cannot exceed 12 STRK.
          </AlertDescription>
        </Alert>

        {prepared ? (
          <Alert>
            <AlertTitle>
              Real {operationLabel(prepared.operation).toLowerCase()} proof ready — review
              before broadcast
            </AlertTitle>
            <AlertDescription className="grid gap-1">
              <span>Amount: {formatUsdc(prepared.amount)} USDC</span>
              <span>Public USDC: {formatUsdc(prepared.publicUsdc)} USDC</span>
              <span>Proving-block public USDC: {formatUsdc(prepared.provingUsdc)} USDC</span>
              <span>Private USDC before: {formatUsdc(prepared.privateUsdcBefore)} USDC</span>
              {prepared.operation !== "shield" ? (
                <span>
                  Selected notes: {prepared.selectedNoteCount} · {formatUsdc(prepared.selectedTotal)} USDC
                </span>
              ) : null}
              {prepared.operation === "transfer" ? (
                <span className="break-all">Private recipient: {prepared.recipient}</span>
              ) : null}
              {prepared.readiness ? <span>Recipient readiness: {prepared.readiness}</span> : null}
              <span>Public STRK balance: {formatStrk(prepared.publicStrk)} STRK</span>
              <span>Pool fee: {formatStrk(prepared.poolFee)} STRK</span>
              <span>Maximum gas cap: {formatStrk(prepared.maximumFee)} STRK</span>
              <span>Nonce: {prepared.nonce.toString()}</span>
              <span>Proving block: {prepared.provingBlock}</span>
              <span>
                Proof: {prepared.proofBytes.toLocaleString()} bytes · {prepared.proofFacts} fact(s)
              </span>
            </AlertDescription>
          </Alert>
        ) : null}

        {operationState ? (
          <Alert variant={operationState.status === "failed" ? "destructive" : "default"}>
            <AlertTitle>
              USDC {operationLabel(operationState.operation).toLowerCase()} {operationState.status}
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{operationState.message}</span>
              {operationState.txHash ? (
                <a
                  href={`${SEPOLIA.explorer}/tx/${operationState.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all font-mono underline underline-offset-4"
                >
                  {operationState.txHash}
                  <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>USDC preparation stopped</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void refreshBalances()}>
          {refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
          {refreshing ? "Discovering balances" : "Refresh USDC balances"}
        </Button>
        {(["shield", "transfer", "unshield"] as const).map((operation) => (
          <Button
            key={operation}
            type="button"
            variant="outline"
            disabled={busy || (operation === "transfer" && !recipientInput.trim())}
            onClick={() => void prepareOperation(operation)}
          >
            {preparing === operation ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <KeyRoundIcon data-icon="inline-start" />
            )}
            {preparing === operation
              ? "Signing and proving"
              : `Prepare ${operationLabel(operation)} USDC`}
          </Button>
        ))}
        <Button
          type="button"
          disabled={!prepared || busy || !!operationState}
          onClick={() => void submitPrepared()}
        >
          {sending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
          {sending
            ? "Waiting for MetaMask"
            : prepared
              ? `Sign and ${operationLabel(prepared.operation).toLowerCase()}`
              : "Prepare an operation first"}
        </Button>
        {operationState?.status === "confirmed" || operationState?.status === "failed" ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setOperationState(null);
              setPrepared(null);
              payload.current = null;
            }}
          >
            Continue with next operation
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

