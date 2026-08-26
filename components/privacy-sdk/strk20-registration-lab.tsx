"use client";

import { useRef, useState } from "react";
import { ExternalLinkIcon, KeyRoundIcon, SendIcon } from "lucide-react";
import { getAddress, padHex, recoverTypedDataAddress } from "viem";
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
import { useNetwork } from "@/components/network-provider";
import type { AppNetwork } from "@/lib/network";
import { privacySdkOf, type PrivacySdkNetwork } from "@/lib/privacy/network";
import {
  eth712Strk20ClassMode,
  strk20UpgradeCall,
  STRK20_ETH712_ACCOUNT_CLASS_HASH,
} from "@/lib/privacy/eth712-account";
import {
  Eth712TransactionSigner,
  ETH712_TEST_MAXIMUM_GAS_FEE,
  eth712FundedResourceBounds,
  safeEth712TransactionError,
} from "@/lib/privacy/eth712-transaction";
import { privacyKeyTypedData } from "@/lib/privacy/eip712-test";
import { readPoolFee } from "@/lib/starknet/pool-fee";
import { formatStrk, getAccountSnapshot } from "@/lib/starknet/status";
import {
  bounded,
  pollTransactionReceipt,
  WALLET_SUBMISSION_TIMEOUT_MS,
} from "@/lib/starknet/transaction-confirmation";

const STRK_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const PROVING_BLOCK_DEPTH = 10;
const MINIMUM_PRIVACY_RPC_VERSION = [0, 10, 1] as const;
const PROOF1_VERSION = "0x50524f4f4631";

type PreparedRegistration = {
  accountAddress: string;
  evmAddress: string;
  evmChainId: number;
  nonce: bigint;
  provingBlock: number;
  poolFee: bigint;
  publicBalance: bigint;
  resourceBounds: ResourceBoundsBN;
  maximumFee: bigint;
  proofBytes: number;
  proofFacts: number;
  sourceClassHash: string;
  rpcSpecVersion: string;
};

type PreparedUpgrade = {
  accountAddress: string;
  evmAddress: string;
  evmChainId: number;
  nonce: bigint;
  publicBalance: bigint;
  resourceBounds: ResourceBoundsBN;
  maximumFee: bigint;
  sourceClassHash: string;
};

type RegistrationPayload = {
  calls: Call[];
  proof: string;
  proofFacts: string[];
};

type RegistrationState = {
  status: "unknown" | "pending" | "confirmed" | "failed" | "already_registered";
  message: string;
  txHash?: string;
};

type UpgradeState = {
  status: "unknown" | "pending" | "confirmed" | "failed";
  message: string;
  txHash?: string;
};

function maximumFee(bounds: ResourceBoundsBN) {
  return (
    bounds.l1_gas.max_amount * bounds.l1_gas.max_price_per_unit +
    bounds.l2_gas.max_amount * bounds.l2_gas.max_price_per_unit +
    bounds.l1_data_gas.max_amount * bounds.l1_data_gas.max_price_per_unit
  );
}

function markerKey(network: AppNetwork, accountAddress: string) {
  return `morokpay:eth712-strk20-register:${network}:${accountAddress.toLowerCase()}`;
}

function restoredRegistration(
  network: AppNetwork,
  accountAddress: string | null,
): RegistrationState | null {
  if (!accountAddress) return null;
  const stored = window.localStorage.getItem(markerKey(network, accountAddress));
  if (!stored) return null;
  try {
    const marker = JSON.parse(stored) as {
      status?: string;
      txHash?: string;
    };
    if (marker.status === "confirmed") {
      return {
        status: "confirmed",
        txHash: marker.txHash,
        message:
          "This browser recorded a confirmed registration. Reconnect the viewing key before checking private balances.",
      };
    }
    return {
      status: marker.txHash ? "pending" : "unknown",
      txHash: marker.txHash,
      message: marker.txHash
        ? "A registration was already submitted from this account. Check that hash instead of sending another one."
        : "A previous registration request did not return a hash. Do not submit again until its nonce and pool state are checked.",
    };
  } catch {
    window.localStorage.removeItem(markerKey(network, accountAddress));
    return null;
  }
}

function proofByteLength(proof: string) {
  const padding = proof.endsWith("==") ? 2 : proof.endsWith("=") ? 1 : 0;
  return Math.max(0, (proof.length * 3) / 4 - padding);
}

function approvalCall(amount: bigint, poolAddress: string): Call {
  const value = cairo.uint256(amount);
  return {
    contractAddress: STRK_ADDRESS,
    entrypoint: "approve",
    calldata: [poolAddress, value.low.toString(), value.high.toString()],
  };
}

function safeRegistrationPreparationError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (/user rejected|rejected the request|error code 4001/i.test(message)) {
    return "MetaMask signature request was rejected. Nothing was submitted.";
  }
  if (/EMPTY_PROOF_FACTS/i.test(message)) {
    return "The fee-estimation RPC discarded proof facts. No transaction was prepared or submitted.";
  }
  if (caught instanceof RpcError) {
    if (caught.isType("TRANSACTION_EXECUTION_ERROR")) {
      const frames: string[] = [];
      let executionError = caught.baseError.data.execution_error;
      while (typeof executionError !== "string") {
        frames.push(
          `contract ${executionError.contract_address}, selector ${executionError.selector}`,
        );
        executionError = executionError.error;
      }
      const reason = executionError
        .replace(/0x[0-9a-f]{256,}/gi, "[large hex payload hidden]")
        .slice(0, 600);
      return `Privacy RPC 41: ${frames.join(" -> ")} -> ${reason}`;
    }
    const rpcMessage = String(caught.baseError.message)
      .replace(/0x[0-9a-f]{256,}/gi, "[large hex payload hidden]")
      .slice(0, 600);
    return `Privacy RPC ${caught.code}: ${rpcMessage}`;
  }
  if (/starknet_estimateFee/i.test(message) || message.length > 800) {
    return "Sepolia could not estimate the proof-backed registration. Raw proof data is hidden.";
  }
  return message;
}

function privacyProvider(sdk: PrivacySdkNetwork) {
  return new RpcProvider({
    nodeUrl: sdk.privacyRpcUrl,
    specVersion: "0.10.3",
  });
}

async function assertPrivacyRpcVersion(sdk: PrivacySdkNetwork) {
  const response = await fetch(sdk.privacyRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_specVersion",
      params: [],
    }),
  });
  if (!response.ok) {
    throw new Error(`Privacy RPC health check failed with HTTP ${response.status}.`);
  }
  const result = (await response.json()) as { result?: unknown; error?: unknown };
  if (typeof result.result !== "string") {
    throw new Error("Privacy RPC did not return a Starknet specification version.");
  }
  const version = result.result.match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  if (
    !version ||
    version.some(
      (part, index) =>
        part < MINIMUM_PRIVACY_RPC_VERSION[index] &&
        version.slice(0, index).every((value, prefix) =>
          value === MINIMUM_PRIVACY_RPC_VERSION[prefix],
        ),
    )
  ) {
    throw new Error(
      `Privacy transactions require Starknet RPC 0.10.1 or newer; this endpoint reports ${result.result}.`,
    );
  }
  return result.result;
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

export function Strk20RegistrationLab({
  inspection,
  signatureTestPassed,
  onAccountChanged,
}: {
  inspection: Eth712AccountInspection | null;
  signatureTestPassed: boolean;
  onAccountChanged?: () => Promise<unknown> | unknown;
}) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { network, starknet } = useNetwork();
  const sdk = privacySdkOf(network);
  const accountAddress = inspection?.deployed ? inspection.starknetAddress : null;
  const deployedClassMode = inspection?.deployedClassHash
    ? eth712Strk20ClassMode(inspection.deployedClassHash)
    : null;
  const payload = useRef<RegistrationPayload | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [prepared, setPrepared] = useState<PreparedRegistration | null>(null);
  const [preparingUpgrade, setPreparingUpgrade] = useState(false);
  const [sendingUpgrade, setSendingUpgrade] = useState(false);
  const [preparedUpgrade, setPreparedUpgrade] = useState<PreparedUpgrade | null>(
    null,
  );
  const [upgrade, setUpgrade] = useState<UpgradeState | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [registration, setRegistration] = useState<RegistrationState | null>(() =>
    restoredRegistration(network, accountAddress),
  );
  const [error, setError] = useState<string | null>(null);

  async function refreshParentInspection() {
    try {
      await onAccountChanged?.();
    } catch {
      // The confirmed transaction state is authoritative. A later read failure
      // must not turn it into a failed upgrade or registration in the UI.
    }
  }

  function outerAccount(
    starknetAddress: string,
    evmChainId: number,
    evmAddress: string,
    provider = new RpcProvider({ nodeUrl: starknet.rpc }),
  ) {
    const signer = new Eth712TransactionSigner({
      accountAddress: starknetAddress,
      snChainName: sdk.snChainName,
      evmChainId,
      signTypedData: async (typedData) => {
        const signature = await signTypedDataAsync(typedData);
        const recovered = await recoverTypedDataAddress({
          ...typedData,
          signature,
        });
        if (recovered.toLowerCase() !== evmAddress.toLowerCase()) {
          throw new Error(`MetaMask signed with ${recovered}, expected ${evmAddress}.`);
        }
        return signature;
      },
    });
    return new Account({
      provider,
      address: starknetAddress,
      signer,
      cairoVersion: "1",
    });
  }

  async function prepareUpgrade() {
    if (!address || !chainId || !accountAddress) return;
    setPreparingUpgrade(true);
    setPreparedUpgrade(null);
    setUpgrade(null);
    setUpgradeError(null);

    try {
      const provider = new RpcProvider({ nodeUrl: starknet.rpc });
      const sourceClassHash = await provider.getClassHashAt(accountAddress);
      const classMode = eth712Strk20ClassMode(sourceClassHash);
      if (classMode === "compatible") {
        setUpgrade({
          status: "confirmed",
          message:
            "The account already uses the STRK20-compatible class. Wait until the proving block sees it, then prepare registration.",
        });
        return;
      }
      if (classMode !== "atomic_upgrade_required") {
        throw new Error(
          `Account class ${sourceClassHash} is not an approved upgrade source.`,
        );
      }

      const account = outerAccount(accountAddress, chainId, address);
      const [nonceValue, snapshot] = await Promise.all([
        account.getNonce(),
        getAccountSnapshot(accountAddress, network),
      ]);
      const nonce = BigInt(nonceValue);
      const estimate = await account.estimateInvokeFee(
        [strk20UpgradeCall(accountAddress)],
        { nonce, skipValidate: true, tip: BigInt(0) },
      );
      const resourceBounds = eth712FundedResourceBounds({
        estimated: estimate.resourceBounds,
        publicBalance: snapshot.strkWei,
        transferAmount: BigInt(0),
        maximumFeeCap: ETH712_TEST_MAXIMUM_GAS_FEE,
      });
      setPreparedUpgrade({
        accountAddress,
        evmAddress: address,
        evmChainId: chainId,
        nonce,
        publicBalance: snapshot.strkWei,
        resourceBounds,
        maximumFee: maximumFee(resourceBounds),
        sourceClassHash,
      });
    } catch (caught) {
      setUpgradeError(
        caught instanceof Error ? caught.message : "Could not prepare account upgrade",
      );
    } finally {
      setPreparingUpgrade(false);
    }
  }

  async function submitUpgrade() {
    if (!preparedUpgrade || !address || !chainId || !accountAddress) return;
    if (
      preparedUpgrade.accountAddress !== accountAddress ||
      preparedUpgrade.evmAddress.toLowerCase() !== address.toLowerCase() ||
      preparedUpgrade.evmChainId !== chainId
    ) {
      setPreparedUpgrade(null);
      setUpgradeError("The connected wallet changed. Prepare the upgrade again.");
      return;
    }

    setSendingUpgrade(true);
    setUpgradeError(null);
    try {
      const provider = new RpcProvider({ nodeUrl: starknet.rpc });
      const currentClassHash = await provider.getClassHashAt(accountAddress);
      if (BigInt(currentClassHash) !== BigInt(preparedUpgrade.sourceClassHash)) {
        setPreparedUpgrade(null);
        throw new Error("The account class changed. Prepare the upgrade again.");
      }
      const account = outerAccount(accountAddress, chainId, address);
      const currentNonce = BigInt(await account.getNonce());
      if (currentNonce !== preparedUpgrade.nonce) {
        setPreparedUpgrade(null);
        throw new Error("The Starknet nonce changed. Prepare the upgrade again.");
      }

      const submission = await bounded(
        account.execute([strk20UpgradeCall(accountAddress)], {
          nonce: preparedUpgrade.nonce,
          resourceBounds: preparedUpgrade.resourceBounds,
          tip: BigInt(0),
        }),
        WALLET_SUBMISSION_TIMEOUT_MS,
      );
      if (submission.status === "timed_out") {
        setUpgrade({
          status: "unknown",
          message:
            "MetaMask did not return a hash within 90 seconds. Do not submit again; check the account class and nonce first.",
        });
        return;
      }

      const txHash = String(submission.value.transaction_hash);
      setUpgrade({
        status: "pending",
        txHash,
        message: "The public account upgrade was submitted to Sepolia.",
      });
      const receipt = await pollTransactionReceipt({
        read: () => provider.getTransactionReceipt(txHash),
      });
      if (receipt === "failed") {
        setUpgrade({
          status: "failed",
          txHash,
          message: "The account upgrade failed on Starknet.",
        });
        return;
      }
      if (receipt === "confirmed") {
        setPreparedUpgrade(null);
        setUpgrade({
          status: "confirmed",
          txHash,
          message:
            "Upgrade confirmed. Wait about 10 Starknet blocks so the prover sees the new class, then prepare registration.",
        });
        await refreshParentInspection();
        return;
      }
      setUpgrade({
        status: "pending",
        txHash,
        message:
          "The hash is known, but this RPC has not confirmed it yet. Do not submit a second upgrade.",
      });
    } catch (caught) {
      setUpgrade({
        status: "failed",
        message:
          caught instanceof Error
            ? caught.message
            : safeEth712TransactionError(caught),
      });
    } finally {
      setSendingUpgrade(false);
    }
  }

  async function prepareRegistration() {
    if (!address || !chainId || !accountAddress) return;
    setPreparing(true);
    setPrepared(null);
    setRegistration(null);
    setError(null);
    payload.current = null;

    try {
      const rpcSpecVersion = await assertPrivacyRpcVersion(sdk);
      const provider = privacyProvider(sdk);
      const latestBlock = await provider.getBlockNumber();
      const provingBlock = latestBlock - PROVING_BLOCK_DEPTH;
      const [currentClassHash, provingClassHash] = await Promise.all([
        provider.getClassHashAt(accountAddress),
        provider.getClassHashAt(accountAddress, provingBlock),
      ]);
      if (eth712Strk20ClassMode(currentClassHash) !== "compatible") {
        throw new Error(
          "Upgrade the Eth712 account before preparing STRK20 registration.",
        );
      }
      if (eth712Strk20ClassMode(provingClassHash) !== "compatible") {
        throw new Error(
          `Proving block ${provingBlock} still sees the legacy account class. Wait for about ${PROVING_BLOCK_DEPTH} blocks after the upgrade and try again.`,
        );
      }

      const keyRequest = privacyKeyTypedData({
        evmAddress: address,
        evmChainId: chainId,
        starknetChain: sdk.snChainName,
        privacyPool: BigInt(sdk.poolAddress),
        accountFactory: BigInt(sdk.accountFactory),
      });
      const keySignature = await signTypedDataAsync(keyRequest);
      const recoveredKeySigner = await recoverTypedDataAddress({
        ...keyRequest,
        signature: keySignature,
      });
      if (recoveredKeySigner.toLowerCase() !== address.toLowerCase()) {
        throw new Error(
          `MetaMask signed with ${recoveredKeySigner}, expected ${address}.`,
        );
      }

      const viewingKey = deriveViewingKey(keySignature, accountAddress);
      const callSetSigner = new Eip712TypedDataSigner({
        accountAddress,
        snChainName: sdk.snChainName,
        evmChainId: chainId,
        signTypedData: async (typedData) => {
          const normalized = viemCallSetTypedData(typedData);
          const signature = await signTypedDataAsync(normalized);
          const recovered = await recoverTypedDataAddress({
            ...normalized,
            signature,
          });
          if (recovered.toLowerCase() !== address.toLowerCase()) {
            throw new Error(`MetaMask signed with ${recovered}, expected ${address}.`);
          }
          return signature;
        },
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
        setRegistration({
          status: "already_registered",
          message:
            "Discovery confirms that this deterministic account is already registered in the privacy pool.",
        });
        return;
      }

      const [poolFee, snapshot] = await Promise.all([
        readPoolFee(network),
        getAccountSnapshot(accountAddress, network),
      ]);
      const account = outerAccount(accountAddress, chainId, address, provider);
      const nonce = BigInt(await account.getNonce());
      const builder = transfers.build().register();
      const invocation = await builder.createProofInvocation({
        provingBlockId: provingBlock,
      });
      const result = await transfers.executeWithInvocation(invocation, provingBlock);
      const callAndProof: CallAndProof = result.callAndProof;
      if (!callAndProof.proof.proofFacts.length) {
        throw new Error(
          "The prover returned no proof facts. Registration was not prepared and must not be submitted.",
        );
      }
      if (BigInt(callAndProof.proof.proofFacts[0]) !== BigInt(PROOF1_VERSION)) {
        throw new Error(
          `The prover returned unsupported proof version ${callAndProof.proof.proofFacts[0]}.`,
        );
      }
      const calls = [approvalCall(poolFee, sdk.poolAddress), callAndProof.call];
      const proofDetails = {
        proof: callAndProof.proof.data,
        proofFacts: callAndProof.proof.proofFacts,
      };
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

      payload.current = { calls, ...proofDetails };
      setPrepared({
        accountAddress,
        evmAddress: address,
        evmChainId: chainId,
        nonce,
        provingBlock,
        poolFee,
        publicBalance: snapshot.strkWei,
        resourceBounds,
        maximumFee: maximumFee(resourceBounds),
        proofBytes: proofByteLength(callAndProof.proof.data),
        proofFacts: callAndProof.proof.proofFacts.length,
        sourceClassHash: provingClassHash,
        rpcSpecVersion,
      });
    } catch (caught) {
      payload.current = null;
      setError(safeRegistrationPreparationError(caught));
    } finally {
      setPreparing(false);
    }
  }

  async function submitRegistration() {
    const transaction = payload.current;
    if (!prepared || !transaction || !address || !chainId || !accountAddress) return;
    if (
      prepared.accountAddress !== accountAddress ||
      prepared.evmAddress.toLowerCase() !== address.toLowerCase() ||
      prepared.evmChainId !== chainId
    ) {
      payload.current = null;
      setPrepared(null);
      setError("The connected wallet changed. Prepare registration again.");
      return;
    }

    setSending(true);
    setError(null);
    const key = markerKey(network, accountAddress);
    window.localStorage.setItem(
      key,
      JSON.stringify({ status: "submitting", nonce: prepared.nonce.toString() }),
    );

    try {
      await assertPrivacyRpcVersion(sdk);
      const provider = privacyProvider(sdk);
      const account = outerAccount(accountAddress, chainId, address, provider);
      const currentClassHash = await provider.getClassHashAt(accountAddress);
      if (BigInt(currentClassHash) !== BigInt(prepared.sourceClassHash)) {
        window.localStorage.removeItem(key);
        payload.current = null;
        setPrepared(null);
        throw new Error("The account class changed. Prepare registration again.");
      }
      const latestNonce = BigInt(await account.getNonce());
      if (latestNonce !== prepared.nonce) {
        window.localStorage.removeItem(key);
        payload.current = null;
        setPrepared(null);
        throw new Error("The Starknet nonce changed. Prepare registration again.");
      }

      const submission = await bounded(
        account.execute(transaction.calls, {
          nonce: prepared.nonce,
          resourceBounds: prepared.resourceBounds,
          tip: BigInt(0),
          proof: transaction.proof,
          proofFacts: transaction.proofFacts,
        }),
        WALLET_SUBMISSION_TIMEOUT_MS,
      );
      if (submission.status === "timed_out") {
        setRegistration({
          status: "unknown",
          message:
            "MetaMask did not return a hash within 90 seconds. Do not submit again; check the account nonce and pool registration first.",
        });
        return;
      }

      const txHash = String(submission.value.transaction_hash);
      window.localStorage.setItem(
        key,
        JSON.stringify({ status: "pending", txHash }),
      );
      setRegistration({
        status: "pending",
        txHash,
        message: "The real proof-backed registration was submitted to Sepolia.",
      });

      const receipt = await pollTransactionReceipt({
        read: () => account.provider.getTransactionReceipt(txHash),
      });
      if (receipt === "failed") {
        window.localStorage.removeItem(key);
        setRegistration({
          status: "failed",
          txHash,
          message: "The registration transaction failed on Starknet.",
        });
        return;
      }
      if (receipt === "confirmed") {
        window.localStorage.setItem(
          key,
          JSON.stringify({ status: "confirmed", txHash }),
        );
        payload.current = null;
        setRegistration({
          status: "confirmed",
          txHash,
          message:
            "Registration is confirmed. The derived viewing key stayed in this browser tab; MetaMask retains the EVM signing key.",
        });
        await refreshParentInspection();
        return;
      }
      setRegistration({
        status: "pending",
        txHash,
        message:
          "The hash is known, but this RPC has not confirmed it yet. Do not submit a second registration.",
      });
    } catch (caught) {
      window.localStorage.removeItem(key);
      setRegistration({
        status: "failed",
        message:
          caught instanceof Error
            ? caught.message
            : safeEth712TransactionError(caught),
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>7. Register the MetaMask account in STRK20</CardTitle>
        <CardDescription>
          This is the first real Privacy SDK operation. Preparation derives a
          viewing key in memory, obtains a real proof, and estimates the public
          InvokeV3. Nothing is broadcast until the final button.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Privacy account</p>
            <p className="break-all font-mono font-medium">
              {accountAddress ?? "Deploy the deterministic account first"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Privacy pool</p>
            <p className="break-all font-mono font-medium">{sdk.poolAddress}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Signing key</p>
            <p className="font-medium">MetaMask EVM key</p>
          </div>
          <div>
            <p className="text-muted-foreground">Viewing key</p>
            <p className="font-medium">Derived in this browser tab only</p>
          </div>
        </div>

        {deployedClassMode === "atomic_upgrade_required" ||
        preparedUpgrade ||
        upgrade ||
        upgradeError ? (
          <Alert variant={upgradeError || upgrade?.status === "failed" ? "destructive" : "default"}>
            <AlertTitle>STRK20-compatible account upgrade</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>
                The deployed account uses the legacy two-argument CallSet validator.
                Registration needs a separate public self-upgrade before proving.
              </span>
              <span className="break-all font-mono text-xs">
                Target class: {STRK20_ETH712_ACCOUNT_CLASS_HASH}
              </span>
              {preparedUpgrade ? (
                <span className="grid gap-1">
                  <span>
                    Public balance: {formatStrk(preparedUpgrade.publicBalance)} STRK
                  </span>
                  <span>
                    Balance-bounded maximum gas cap: {formatStrk(preparedUpgrade.maximumFee)} STRK
                  </span>
                  <span>Nonce: {preparedUpgrade.nonce.toString()}</span>
                  <span>
                    The upgrade preserves the EVM owner and account address. It does
                    not register or move funds.
                  </span>
                </span>
              ) : null}
              {upgrade ? <span>{upgrade.message}</span> : null}
              {upgrade?.txHash ? (
                <a
                  href={`${starknet.explorer}/tx/${upgrade.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all font-mono underline underline-offset-4"
                >
                  {upgrade.txHash}
                  <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : null}
              {upgradeError ? <span>{upgradeError}</span> : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <Alert>
          <AlertTitle>Preparation needs two MetaMask confirmations</AlertTitle>
          <AlertDescription>
            The first repeatable EIP-712 signature derives the viewing key. The
            second CallSet signature authorizes the prover input. A third,
            separate confirmation is requested only when broadcasting the
            public registration transaction.
          </AlertDescription>
        </Alert>

        {prepared ? (
          <Alert>
            <AlertTitle>Real proof ready — review before broadcast</AlertTitle>
            <AlertDescription className="grid gap-1">
              <span>Public balance: {formatStrk(prepared.publicBalance)} STRK</span>
              <span>Pool fee: {formatStrk(prepared.poolFee)} STRK</span>
              <span>
                Balance-bounded maximum gas cap: {formatStrk(prepared.maximumFee)} STRK
              </span>
              <span>Nonce: {prepared.nonce.toString()}</span>
              <span>Proving block: {prepared.provingBlock}</span>
              <span>Privacy RPC specification: {prepared.rpcSpecVersion}</span>
              <span>
                Proof: {prepared.proofBytes.toLocaleString()} bytes · {prepared.proofFacts}{" "}
                fact(s)
              </span>
              <span>
                One InvokeV3 batches public STRK approval and the pool&apos;s
                proof-backed register call. Starknet charges actual gas, not the
                maximum cap.
              </span>
            </AlertDescription>
          </Alert>
        ) : null}

        {registration ? (
          <Alert variant={registration.status === "failed" ? "destructive" : "default"}>
            <AlertTitle>STRK20 registration {registration.status.replace("_", " ")}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{registration.message}</span>
              {registration.txHash ? (
                <a
                  href={`${starknet.explorer}/tx/${registration.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all font-mono underline underline-offset-4"
                >
                  {registration.txHash}
                  <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Registration preparation stopped</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {deployedClassMode === "atomic_upgrade_required" || preparedUpgrade ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={
                !accountAddress ||
                !address ||
                !chainId ||
                preparingUpgrade ||
                sendingUpgrade ||
                (!!upgrade && upgrade.status !== "failed")
              }
              onClick={() => void prepareUpgrade()}
            >
              {preparingUpgrade ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <KeyRoundIcon data-icon="inline-start" />
              )}
              {preparingUpgrade ? "Simulating upgrade" : "Prepare account upgrade"}
            </Button>
            <Button
              type="button"
              disabled={!preparedUpgrade || preparingUpgrade || sendingUpgrade || !!upgrade}
              onClick={() => void submitUpgrade()}
            >
              {sendingUpgrade ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SendIcon data-icon="inline-start" />
              )}
              {sendingUpgrade ? "Waiting for MetaMask" : "Sign and upgrade on Sepolia"}
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={
            !accountAddress ||
            !address ||
            !chainId ||
            !signatureTestPassed ||
            preparing ||
            sending ||
            preparingUpgrade ||
            sendingUpgrade ||
            (deployedClassMode === "atomic_upgrade_required" &&
              upgrade?.status !== "confirmed") ||
            (!!registration && registration.status !== "failed")
          }
          onClick={() => void prepareRegistration()}
        >
          {preparing ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
          {preparing ? "Signing and proving" : "Prepare real registration"}
        </Button>
        <Button
          type="button"
          disabled={!prepared || preparing || sending || !!registration}
          onClick={() => void submitRegistration()}
        >
          {sending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
          {sending ? "Waiting for MetaMask" : "Sign and register on Sepolia"}
        </Button>
      </CardFooter>
    </Card>
  );
}
