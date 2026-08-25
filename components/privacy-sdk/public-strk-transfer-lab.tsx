"use client";

import { useMemo, useState } from "react";
import { ExternalLinkIcon, SendIcon } from "lucide-react";
import { parseUnits, recoverTypedDataAddress } from "viem";
import { Account, RpcProvider, type Call, type ResourceBoundsBN } from "starknet";
import { useAccount, useSignTypedData } from "wagmi";

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
import { Eth712TransactionSigner } from "@/lib/privacy/eth712-transaction";
import { publicStrkTransferCall } from "@/lib/starknet/actions";
import { starknetOf } from "@/lib/starknet/constants";
import { getAccountSnapshot, formatStrk } from "@/lib/starknet/status";
import {
  bounded,
  pollTransactionReceipt,
  WALLET_SUBMISSION_TIMEOUT_MS,
} from "@/lib/starknet/transaction-confirmation";

const TEST_AMOUNT = parseUnits("0.01", 18);
const SN_CHAIN_NAME = "SN_SEPOLIA";

type PreparedTransfer = {
  balance: bigint;
  nonce: bigint;
  resourceBounds: ResourceBoundsBN;
  maxFee: bigint;
  evmAddress: string;
  evmChainId: number;
  starknetAddress: string;
};

type TransferState = {
  status: "unknown" | "pending" | "confirmed" | "failed";
  message: string;
  txHash?: string;
  balanceAfter?: bigint;
};

function maxFee(bounds: ResourceBoundsBN) {
  return (
    bounds.l1_gas.max_amount * bounds.l1_gas.max_price_per_unit +
    bounds.l2_gas.max_amount * bounds.l2_gas.max_price_per_unit +
    bounds.l1_data_gas.max_amount * bounds.l1_data_gas.max_price_per_unit
  );
}

function markerKey(accountAddress: string) {
  return `morokpay:eth712-public-transfer:sepolia:${accountAddress.toLowerCase()}`;
}

function restoredTransfer(accountAddress: string | null): TransferState | null {
  if (!accountAddress) return null;
  const stored = window.localStorage.getItem(markerKey(accountAddress));
  if (!stored) return null;
  try {
    const marker = JSON.parse(stored) as {
      status?: string;
      txHash?: string;
    };
    return {
      status: marker.txHash ? "pending" : "unknown",
      txHash: marker.txHash,
      message: marker.txHash
        ? "A test transfer was already submitted from this account. Check it instead of sending another one."
        : "A previous wallet request did not return a hash. Do not submit again until its nonce is checked.",
    };
  } catch {
    window.localStorage.removeItem(markerKey(accountAddress));
    return null;
  }
}

export function PublicStrkTransferLab({
  inspection,
}: {
  inspection: Eth712AccountInspection | null;
}) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const sepolia = starknetOf("sepolia");
  const accountAddress = inspection?.deployed
    ? inspection.starknetAddress
    : null;
  const recipient = sepolia.treasury;
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [transfer, setTransfer] = useState<TransferState | null>(() =>
    restoredTransfer(accountAddress),
  );
  const [error, setError] = useState<string | null>(null);

  const call = useMemo<Call | null>(() => {
    if (!recipient) return null;
    return publicStrkTransferCall(recipient, TEST_AMOUNT);
  }, [recipient]);

  function signerAccount(
    starknetAddress: string,
    evmChainId: number,
    evmAddress: string,
  ) {
    const provider = new RpcProvider({ nodeUrl: sepolia.rpc });
    const signer = new Eth712TransactionSigner({
      accountAddress: starknetAddress,
      snChainName: SN_CHAIN_NAME,
      evmChainId,
      signTypedData: async (typedData) => {
        const signature = await signTypedDataAsync(typedData);
        const recoveredAddress = await recoverTypedDataAddress({
          ...typedData,
          signature,
        });
        if (recoveredAddress.toLowerCase() !== evmAddress.toLowerCase()) {
          throw new Error(
            `MetaMask signed with ${recoveredAddress}, expected ${evmAddress}.`,
          );
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

  async function prepareTransfer() {
    if (!address || !chainId || !accountAddress || !call) return;
    setPreparing(true);
    setPrepared(null);
    setTransfer(null);
    setError(null);
    try {
      const account = signerAccount(accountAddress, chainId, address);
      const [snapshot, nonceHex] = await Promise.all([
        getAccountSnapshot(accountAddress, "sepolia"),
        account.getNonce(),
      ]);
      const nonce = BigInt(nonceHex);
      const estimate = await account.estimateInvokeFee(call, {
        nonce,
        skipValidate: true,
        tip: BigInt(0),
      });
      const maximumFee = maxFee(estimate.resourceBounds);
      if (snapshot.strkWei < TEST_AMOUNT + maximumFee) {
        throw new Error(
          `Not enough public STRK. Need at least ${formatStrk(TEST_AMOUNT + maximumFee)} STRK for the transfer and maximum fee.`,
        );
      }
      setPrepared({
        balance: snapshot.strkWei,
        nonce,
        resourceBounds: estimate.resourceBounds,
        maxFee: maximumFee,
        evmAddress: address,
        evmChainId: chainId,
        starknetAddress: accountAddress,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not prepare the public STRK transfer",
      );
    } finally {
      setPreparing(false);
    }
  }

  async function sendTransfer() {
    if (!address || !chainId || !accountAddress || !call || !prepared) return;
    if (
      prepared.evmAddress.toLowerCase() !== address.toLowerCase() ||
      prepared.evmChainId !== chainId ||
      prepared.starknetAddress !== accountAddress
    ) {
      setPrepared(null);
      setError("The connected account or chain changed. Prepare the transfer again.");
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
      const account = signerAccount(accountAddress, chainId, address);
      const latestNonce = BigInt(await account.getNonce());
      if (latestNonce !== prepared.nonce) {
        window.localStorage.removeItem(key);
        setPrepared(null);
        throw new Error("The Starknet nonce changed. Prepare the transfer again.");
      }
      const submission = await bounded(
        account.execute(call, {
          nonce: prepared.nonce,
          resourceBounds: prepared.resourceBounds,
          tip: BigInt(0),
        }),
        WALLET_SUBMISSION_TIMEOUT_MS,
      );
      if (submission.status === "timed_out") {
        window.localStorage.setItem(
          key,
          JSON.stringify({ status: "unknown", nonce: prepared.nonce.toString() }),
        );
        setTransfer({
          status: "unknown",
          message:
            "MetaMask did not return a hash within 90 seconds. Do not submit again; the request may still complete.",
        });
        return;
      }

      const txHash = String(submission.value.transaction_hash);
      window.localStorage.setItem(
        key,
        JSON.stringify({ status: "pending", txHash }),
      );
      setTransfer({
        status: "pending",
        txHash,
        message: "The MetaMask-signed InvokeV3 was submitted to Sepolia.",
      });
      const receipt = await pollTransactionReceipt({
        read: () => account.provider.getTransactionReceipt(txHash),
      });
      if (receipt === "failed") {
        window.localStorage.removeItem(key);
        setTransfer({
          status: "failed",
          txHash,
          message: "The public STRK transfer failed on Starknet.",
        });
        return;
      }
      if (receipt === "confirmed") {
        const snapshot = await getAccountSnapshot(accountAddress, "sepolia");
        window.localStorage.setItem(
          key,
          JSON.stringify({ status: "confirmed", txHash }),
        );
        setTransfer({
          status: "confirmed",
          txHash,
          balanceAfter: snapshot.strkWei,
          message:
            "The ordinary public STRK transfer was confirmed. MetaMask controls this Starknet account.",
        });
        return;
      }
      setTransfer({
        status: "pending",
        txHash,
        message: "The hash is known but this RPC has not confirmed it yet.",
      });
    } catch (caught) {
      window.localStorage.removeItem(key);
      setTransfer({
        status: "failed",
        message:
          caught instanceof Error
            ? caught.message
            : "MetaMask rejected or failed to submit the transaction",
      });
    } finally {
      setSending(false);
    }
  }

  async function checkTransfer() {
    if (!transfer?.txHash || !accountAddress) return;
    setSending(true);
    try {
      const provider = new RpcProvider({ nodeUrl: sepolia.rpc });
      const receipt = await pollTransactionReceipt({
        read: () => provider.getTransactionReceipt(transfer.txHash!),
      });
      if (receipt === "confirmed") {
        const snapshot = await getAccountSnapshot(accountAddress, "sepolia");
        window.localStorage.setItem(
          markerKey(accountAddress),
          JSON.stringify({ status: "confirmed", txHash: transfer.txHash }),
        );
        setTransfer((current) =>
          current
            ? {
                ...current,
                status: "confirmed",
                balanceAfter: snapshot.strkWei,
                message:
                  "The ordinary public STRK transfer was confirmed. MetaMask controls this Starknet account.",
              }
            : current,
        );
      } else if (receipt === "failed") {
        window.localStorage.removeItem(markerKey(accountAddress));
        setTransfer((current) =>
          current
            ? { ...current, status: "failed", message: "The transaction failed." }
            : current,
        );
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>5. Send public STRK with MetaMask</CardTitle>
        <CardDescription>
          This is an ordinary Starknet InvokeV3 paid by the generated account.
          Ready and STRK20 are not involved.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">From</p>
            <p className="break-all font-mono font-medium">
              {accountAddress ?? "Deploy the account first"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">To · test treasury</p>
            <p className="break-all font-mono font-medium">{recipient}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Amount</p>
            <p className="font-medium">0.01 STRK</p>
          </div>
          <div>
            <p className="text-muted-foreground">Gas payer</p>
            <p className="font-medium">Generated account itself</p>
          </div>
        </div>
        {prepared ? (
          <Alert>
            <AlertTitle>Review before signing</AlertTitle>
            <AlertDescription className="grid gap-1">
              <span>Public balance: {formatStrk(prepared.balance)} STRK</span>
              <span>Nonce: {prepared.nonce.toString()}</span>
              <span>Maximum fee bound: {formatStrk(prepared.maxFee)} STRK</span>
              <span>
                MetaMask will sign these calls and exact transaction metadata.
              </span>
            </AlertDescription>
          </Alert>
        ) : null}
        {transfer ? (
          <Alert variant={transfer.status === "failed" ? "destructive" : "default"}>
            <AlertTitle>Public transfer {transfer.status}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{transfer.message}</span>
              {transfer.balanceAfter !== undefined ? (
                <span>Balance after: {formatStrk(transfer.balanceAfter)} STRK</span>
              ) : null}
              {transfer.txHash ? (
                <a
                  href={`${sepolia.explorer}/tx/${transfer.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all font-mono underline underline-offset-4"
                >
                  {transfer.txHash}
                  <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not prepare transfer</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
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
            preparing ||
            sending ||
            (!!transfer && transfer.status !== "failed")
          }
          onClick={() => void prepareTransfer()}
        >
          {preparing ? <Spinner data-icon="inline-start" /> : null}
          {preparing ? "Estimating on Sepolia" : "Prepare 0.01 STRK transfer"}
        </Button>
        <Button
          type="button"
          disabled={
            !prepared ||
            sending ||
            (!!transfer && transfer.status !== "failed")
          }
          onClick={() => void sendTransfer()}
        >
          {sending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
          {sending ? "Waiting for MetaMask" : "Sign and send with MetaMask"}
        </Button>
        {transfer?.txHash && transfer.status === "pending" ? (
          <Button
            type="button"
            variant="outline"
            disabled={sending}
            onClick={() => void checkTransfer()}
          >
            Check transaction
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}
