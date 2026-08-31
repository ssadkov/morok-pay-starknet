"use client";

import { useState } from "react";
import Link from "next/link";
import { CopyIcon, ExternalLinkIcon, RocketIcon, XIcon } from "lucide-react";
import { RpcProvider } from "starknet";
import { toast } from "sonner";
import { useAccount, useSignMessage, useSignTypedData } from "wagmi";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { OWNERSHIP_MESSAGE } from "@/lib/privacy/eth712-account";
import {
  PROVING_BLOCK_DEPTH,
  provingBlockSeesAccount,
  registerEvmAccount,
} from "@/lib/privacy/evm-onboard-actions";
import { formatStrk, getAccountSnapshot } from "@/lib/starknet/status";
import { pollTransactionReceipt } from "@/lib/starknet/transaction-confirmation";

/**
 * Onboarding for a wallet that has no Starknet account yet.
 *
 * This used to be a notice that sent the reader to /privacy-sdk-lab - eight
 * numbered cards with proof sizes and resource bounds, which is the right shape
 * for diagnosing the flow and the wrong shape for using it. The lab is still
 * there, linked at the bottom; this runs the same steps as one sequence.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "waiting"; step: string }
  | { kind: "done"; message: string }
  | { kind: "failed"; message: string };

/** Enough for the pool fee plus gas for the registration that follows. */
const MAINNET_MINIMUM_STRK = BigInt(15) * BigInt(10) ** BigInt(18);
/** Or this much bridged USDC, which buys the STRK the next step needs. */
const MAINNET_MINIMUM_USDC = BigInt(2) * BigInt(10) ** BigInt(6);

export function EvmOnboardingGate() {
  const { evmGate, dismissEvmGate, connectEvm } = useTreasury();
  const { network, starknet } = useNetwork();
  const { address: evmAddress, chainId: evmChainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  if (!evmGate) return null;

  const busy = phase.kind === "working" || phase.kind === "waiting";
  const isMainnet = network === "mainnet";
  const needsDeploy =
    evmGate.reason === "undeployed" || evmGate.reason === "upgrade";
  const canAct =
    Boolean(evmAddress) &&
    Boolean(evmChainId) &&
    Boolean(evmGate.address) &&
    evmGate.reason !== "unsupported" &&
    evmGate.reason !== "error";

  async function copyAddress(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Starknet address copied");
    } catch {
      toast.error("Could not copy address");
    }
  }

  async function waitForProver(accountAddress: string) {
    setPhase({
      kind: "waiting",
      step: "Waiting for the network to catch up, about two minutes",
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await provingBlockSeesAccount(network, accountAddress)) return true;
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
    return false;
  }

  async function runOnboarding() {
    if (!evmAddress || !evmChainId || !evmGate?.address) return;
    const accountAddress = evmGate.address;
    setPhase({ kind: "working", step: "Checking the account" });

    try {
      if (needsDeploy) {
        /* Refuse early with the number rather than after a wallet signature -
           but USDC unlocks the deploy too, so read both before deciding, the
           same way the server does. */
        if (isMainnet) {
          const snapshot = await getAccountSnapshot(accountAddress, network);
          if (
            snapshot.strkWei < MAINNET_MINIMUM_STRK &&
            snapshot.usdcRaw < MAINNET_MINIMUM_USDC
          ) {
            setPhase({
              kind: "failed",
              message: `This account holds ${formatStrk(snapshot.strkWei)} STRK and no bridged USDC. Send at least ${formatStrk(MAINNET_MINIMUM_STRK)} STRK to the address above, or bridge USDC to it, then try again.`,
            });
            return;
          }
        }

        setPhase({ kind: "working", step: "Confirm ownership in your wallet" });
        const signature = await signMessageAsync({ message: OWNERSHIP_MESSAGE });

        setPhase({ kind: "working", step: "Deploying your Starknet account" });
        const response = await fetch("/api/privacy-sdk/deploy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ evmAddress, signature, network }),
        });
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          status?: string;
          transactionHash?: string;
        } | null;
        if (!response.ok) {
          throw new Error(body?.error ?? `Deployment failed (${response.status})`);
        }
        if (body?.transactionHash) {
          setPhase({ kind: "working", step: "Confirming the deployment" });
          const deployTx = body.transactionHash;
          const receipt = await pollTransactionReceipt({
            read: () =>
              new RpcProvider({ nodeUrl: starknet.rpc }).getTransactionReceipt(
                deployTx,
              ),
          });
          if (receipt === "failed") {
            throw new Error("The deployment transaction failed on Starknet.");
          }
        }

        if (!(await waitForProver(accountAddress))) {
          setPhase({
            kind: "failed",
            message: `Your account is deployed, but the prover has not caught up yet. Reopen this in a minute - it needs about ${PROVING_BLOCK_DEPTH} blocks.`,
          });
          return;
        }
      }

      const result = await registerEvmAccount({
        network,
        accountAddress,
        evmAddress,
        evmChainId,
        signTypedData: (typedData) => signTypedDataAsync(typedData as never),
        onProgress: (step) => setPhase({ kind: "working", step }),
      });

      if (result.status === "submitted") {
        setPhase({ kind: "working", step: "Confirming your private account" });
        const receipt = await pollTransactionReceipt({
          read: () =>
            new RpcProvider({ nodeUrl: starknet.rpc }).getTransactionReceipt(
              result.transactionHash,
            ),
        });
        if (receipt === "failed") {
          throw new Error("The registration transaction failed on Starknet.");
        }
      }

      setPhase({
        kind: "done",
        message: "Your private account is ready. Connecting it now.",
      });
      await connectEvm();
      dismissEvmGate();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Onboarding did not complete.";
      setPhase({
        kind: "failed",
        message: /user rejected|rejected the request|4001/i.test(message)
          ? "You declined the signature. Nothing was submitted."
          : message,
      });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evm-onboarding-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              {isMainnet ? "Starknet Mainnet" : "Starknet Sepolia"}
            </p>
            <h2 id="evm-onboarding-title" className="text-xl font-semibold">
              Create your private account
            </h2>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Close"
            disabled={busy}
            onClick={dismissEvmGate}
          >
            <XIcon />
          </Button>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          Your Ethereum wallet keeps its key. MorokPay derives a Starknet
          account from your address, deploys it, and activates STRK20 privacy.
          You never enter a seed phrase and never install a Starknet wallet.
        </p>

        {/* Not a reassurance but a property of the account class: it holds no
            key of its own and authorises on an EIP-712 signature from this
            EVM address, so there is nothing here MorokPay could hold. */}
        <p className="mt-2 text-sm text-muted-foreground">
          The account is non-custodial, and there is no second key to lose:
          it has none of its own and accepts only what your Ethereum wallet
          signs. MorokPay never holds a key and cannot sign for you.
        </p>

        {evmGate.address ? (
          <div className="mt-4 rounded-xl bg-muted/50 p-3 ring-1 ring-foreground/10">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Your Starknet account</p>
                <p className="mt-1 break-all font-mono text-xs tabular-nums">
                  {evmGate.address}
                </p>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="shrink-0"
                aria-label="Copy Starknet address"
                title="Copy address"
                onClick={() => void copyAddress(evmGate.address)}
              >
                <CopyIcon />
              </Button>
            </div>
          </div>
        ) : null}

        {isMainnet && needsDeploy ? (
          <Alert className="mt-4">
            <AlertTitle>Fund this address first</AlertTitle>
            <AlertDescription>
              Send at least {formatStrk(MAINNET_MINIMUM_STRK)} STRK to the
              address above. Activation spends about 11 of it - a 6 STRK pool
              fee plus gas. Moving money back out later costs roughly the same
              again, so send 25 if you would rather not top up twice.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Deployed, unregistered, and the registration is the part the user
            pays for. Someone who arrived over the bridge holds USDC and no
            STRK at all, so the useful answer is not "go get some" but the page
            that buys it out of what they already have. */}
        {isMainnet && !needsDeploy ? (
          <Alert className="mt-4">
            <AlertTitle>Activation costs about 11 STRK</AlertTitle>
            <AlertDescription>
              A 6 STRK pool fee plus gas, paid by this account. If it holds USDC
              instead,{" "}
              <Link
                href="/swap"
                className="underline underline-offset-4"
                onClick={dismissEvmGate}
              >
                buy the STRK with it
              </Link>{" "}
              - about 1 USDC is enough, and no STRK is needed to do the swap.
            </AlertDescription>
          </Alert>
        ) : null}

        {phase.kind === "working" || phase.kind === "waiting" ? (
          <Alert className="mt-4">
            <AlertTitle className="flex items-center gap-2">
              <Spinner />
              {phase.step}
            </AlertTitle>
            <AlertDescription>
              {phase.kind === "waiting"
                ? "The prover reads a block behind the chain head, so a new account takes a moment to become visible. Leave this open."
                : "Keep this tab open until the step finishes."}
            </AlertDescription>
          </Alert>
        ) : null}

        {phase.kind === "failed" ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Onboarding stopped</AlertTitle>
            <AlertDescription>{phase.message}</AlertDescription>
          </Alert>
        ) : null}

        {phase.kind === "done" ? (
          <Alert className="mt-4">
            <AlertTitle>Ready X</AlertTitle>
            <AlertDescription>{phase.message}</AlertDescription>
          </Alert>
        ) : null}

        {phase.kind === "idle" && evmGate.reason === "unsupported" ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Unsupported account</AlertTitle>
            <AlertDescription>{evmGate.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={dismissEvmGate}
          >
            Not now
          </Button>
          <Button
            type="button"
            disabled={busy || !canAct || phase.kind === "done"}
            aria-busy={busy}
            onClick={() => void runOnboarding()}
          >
            {busy ? <Spinner data-icon="inline-start" /> : <RocketIcon data-icon="inline-start" />}
            {busy
              ? "Working"
              : phase.kind === "failed"
                ? "Try again"
                : needsDeploy
                  ? "Create private account"
                  : "Activate privacy"}
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Prefer to run each step yourself?{" "}
          <Link
            href="/privacy-sdk-lab"
            className="underline underline-offset-4"
            onClick={dismissEvmGate}
          >
            Open the EVM lab
            <ExternalLinkIcon className="ml-1 inline size-3" aria-hidden="true" />
          </Link>
        </p>
      </div>
    </div>
  );
}
