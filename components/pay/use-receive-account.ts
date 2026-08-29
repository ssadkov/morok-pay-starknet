"use client";

import { useCallback, useRef, useState } from "react";
import { RpcProvider } from "starknet";
import { useSignMessage, useSignTypedData } from "wagmi";
import type { Hex } from "viem";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import type { AppNetwork } from "@/lib/network";
import { OWNERSHIP_MESSAGE } from "@/lib/privacy/eth712-account";
import { privacySdkOf } from "@/lib/privacy/network";
import {
  createReceiveAccountSession,
  type ReceiveAccountSession,
} from "@/lib/privacy/receive-account-session";
import {
  deriveReceiveAccount,
  receiveAccountTypedData,
} from "@/lib/privacy/receive-account";

/**
 * Standing up the account a creator's QR publishes.
 *
 * Three things have to happen before that QR can receive anything, and they
 * cannot share a transaction: the account is deployed, it ages until the
 * proving block can see it, and only then can it register a viewing key - a
 * proof is checked against a block ten deep, where a younger contract simply
 * does not exist.
 *
 * MorokPay pays for all of it. The creator's main account must never send this
 * one a single wei, because that transfer is public and would tie the two
 * together for good.
 *
 * Nothing is cached between visits. The account is reproduced from a signature
 * every time, and remembering its address without the signature would only
 * show a QR the page cannot yet read a balance for.
 */

const PROVING_BLOCK_DEPTH = 10;
/* Sepolia blocks run about thirty seconds, so ten of them is a few minutes. */
const MATURITY_POLL_MS = 15_000;

export type ReceiveAccountStatus =
  | "unavailable"
  | "absent"
  | "deploying"
  | "maturing"
  | "registering"
  | "ready";

type Progress = {
  network: AppNetwork;
  evmAddress: string;
  status: ReceiveAccountStatus;
  address: string | null;
  session: ReceiveAccountSession | null;
};

export type ReceiveAccountState = {
  status: ReceiveAccountStatus;
  address: string | null;
  session: ReceiveAccountSession | null;
  busy: boolean;
  error: string | null;
  /** What the creator is waiting for, in words worth showing. */
  note: string | null;
};

export function useReceiveAccount(): ReceiveAccountState & {
  activate: () => Promise<void>;
} {
  const { network } = useNetwork();
  const { session } = useTreasury();
  const { signTypedDataAsync } = useSignTypedData();
  const { signMessageAsync } = useSignMessage();

  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const running = useRef(false);

  const evmAddress = session?.kind === "evm" ? session.evmAddress : null;
  const evmChainId = session?.kind === "evm" ? session.evmChainId : null;

  /* Scoped rather than cleared by an effect: switching network or wallet makes
     a different receive account, so progress from the old one simply stops
     applying. */
  const scoped =
    progress &&
    progress.network === network &&
    progress.evmAddress === evmAddress
      ? progress
      : null;

  const activate = useCallback(async () => {
    if (!evmAddress || evmChainId === null) return;
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    const at = (status: ReceiveAccountStatus, extra?: Partial<Progress>) =>
      setProgress((current) => ({
        network,
        evmAddress,
        address: current?.address ?? null,
        session: current?.session ?? null,
        ...current,
        status,
        ...extra,
      }));
    try {
      setNote("Sign to create the account your QR will publish.");
      const signature = (await signTypedDataAsync(
        receiveAccountTypedData({
          evmAddress: evmAddress as Hex,
          evmChainId,
          network,
        }) as never,
      )) as Hex;
      const derived = deriveReceiveAccount(signature);
      const live = createReceiveAccountSession({ signature, network });
      at("deploying", { address: derived.address });

      const sdk = privacySdkOf(network);
      const provider = new RpcProvider({
        nodeUrl: sdk.privacyRpcUrl,
        specVersion: "0.10.3",
      });
      const deployed = async (blockIdentifier?: number) => {
        try {
          await provider.getClassHashAt(derived.address, blockIdentifier);
          return true;
        } catch {
          return false;
        }
      };

      if (!(await deployed())) {
        setNote("Sign once more to prove the wallet is yours; MorokPay pays.");
        const ownership = await signMessageAsync({
          message: OWNERSHIP_MESSAGE,
        });
        const response = await fetch("/api/privacy/receive-account", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            network,
            publicKey: derived.publicKey,
            evmAddress,
            signature: ownership,
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          address?: string;
        } | null;
        if (!response.ok || !payload?.address) {
          throw new Error(
            payload?.error ?? "MorokPay could not create the receive account.",
          );
        }
      }

      /* Registration proves against a block ten deep, so a brand-new account
         has to age into view before the pool will accept its viewing key. */
      at("maturing");
      for (;;) {
        const head = await provider.getBlockNumber();
        if (await deployed(head - PROVING_BLOCK_DEPTH)) break;
        setNote(
          "The account exists. The pool proves against an older block, so registering it takes a few minutes.",
        );
        await new Promise((resolve) => setTimeout(resolve, MATURITY_POLL_MS));
      }

      const [registered] = await provider.callContract({
        contractAddress: sdk.poolAddress,
        entrypoint: "get_public_key",
        calldata: [derived.address],
      });
      if (BigInt(registered ?? 0) === BigInt(0)) {
        at("registering");
        setNote("Publishing the key donations are encrypted to.");
        await live.register();
      }

      at("ready", { session: live });
      setNote(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not set up the receive account.",
      );
      at("absent");
      setNote(null);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [evmAddress, evmChainId, network, signMessageAsync, signTypedDataAsync]);

  return {
    status: evmAddress ? (scoped?.status ?? "absent") : "unavailable",
    address: scoped?.address ?? null,
    session: scoped?.session ?? null,
    busy,
    error,
    note,
    activate,
  };
}
