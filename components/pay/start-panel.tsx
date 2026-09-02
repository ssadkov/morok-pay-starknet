"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckIcon, CircleIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import {
  useAccount,
  useReadContract,
  useSignMessage,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import type { Address } from "viem";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseUsdc } from "@/lib/amount";
import { bridgeUsdcFromBase } from "@/lib/cctp/bridge-from-base";
import { swapUsdcToStrk } from "@/lib/avnu/swap-flow";
import { erc20Abi } from "@/lib/cctp/constants";
import { OWNERSHIP_MESSAGE } from "@/lib/privacy/eth712-account";
import {
  ONBOARDING_ACTIVATION_STRK,
  ONBOARDING_MIN_USDC,
  ONBOARDING_SUGGESTED_USDC,
  ONBOARDING_SWAP_GAS_USDC,
  ONBOARDING_SWAP_USDC,
} from "@/lib/privacy/onboarding-limits";
import { registerEvmAccount } from "@/lib/privacy/evm-onboard-actions";
import { poolRegistration } from "@/lib/starknet/account-status";
import { describeError } from "@/lib/starknet/errors";
import { formatStrk, formatUsdc, getAccountSnapshot } from "@/lib/starknet/status";
import { shortenAddress } from "@/lib/format";

/**
 * The whole way in, on one screen.
 *
 * Every piece of this existed already and was spread across four pages - top
 * up, connect, buy STRK, activate - which asked someone who has never used
 * Starknet to navigate a product they do not understand yet in the right
 * order. Nothing new happens here; what is new is that the screen works out
 * which step is next by reading the chain, so the person only ever sees one
 * button.
 *
 * The order is forced by two facts, not by preference. The account has to
 * exist before anything can be signed on its behalf, and activation carries a
 * proof, which cannot be relayed - so the user has to hold STRK by then, and
 * the swap that buys it has to come first.
 */

/** The pool fee plus gas for the activation the user pays for. */
const ACTIVATION_STRK = ONBOARDING_ACTIVATION_STRK;
/** What a submission burns; below it the account cannot send its own swap. */
const SWAP_GAS_STRK = BigInt(21) * BigInt(10) ** BigInt(17);

type StepId = "bridge" | "deploy" | "strk" | "activate" | "done";

const STEPS: { id: StepId; title: string; detail: string }[] = [
  {
    id: "bridge",
    title: "Get USDC onto Starknet",
    detail: "Bridge it from Base, or send it from an exchange. MorokPay pays the delivery fee.",
  },
  {
    id: "deploy",
    title: "Create your Starknet account",
    detail: "Derived from your Ethereum address. No seed phrase, and MorokPay pays for it.",
  },
  {
    id: "strk",
    title: "Buy the STRK activation costs",
    detail: "About 1 USDC. The swap pays its own gas, so you need no STRK to do it.",
  },
  {
    id: "activate",
    title: "Activate privacy",
    detail: "A one-time pool registration, about 11 STRK, paid by your account.",
  },
];

export function StartPanel() {
  const { session, evmStarknetAddress, connectEvm, evmConnecting, refreshBalances } =
    useTreasury();
  const { network, starknet, cctp, baseChain } = useNetwork();
  const { address: evmAddress, chainId: evmChainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const baseUsdc = cctp.usdc as Address;
  const messenger = cctp.tokenMessenger as Address;
  const { data: baseBalance } = useReadContract({
    address: baseUsdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: evmAddress ? [evmAddress] : undefined,
    chainId: baseChain.id,
    query: { enabled: Boolean(evmAddress) },
  });

  const [state, setState] = useState<{
    usdc: bigint;
    strk: bigint;
    deployed: boolean;
    registered: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(formatUsdc(ONBOARDING_SUGGESTED_USDC));

  const account = session?.address ?? evmStarknetAddress;

  const refresh = useCallback(async () => {
    if (!account) return null;
    try {
      const [snapshot, registration] = await Promise.all([
        getAccountSnapshot(account, network),
        poolRegistration(network, account),
      ]);
      const next = {
        usdc: snapshot.usdcRaw,
        strk: snapshot.strkWei,
        /* Read from the class hash at the address, not inferred from holding
           STRK. An account that arrived over the bridge holds USDC and zero
           STRK, so the old guess said "not deployed" about an account that had
           just been deployed - and the step sat spinning until a reload. */
        deployed: snapshot.status === "deployed",
        registered: registration === "registered",
      };
      setState(next);
      return next;
    } catch {
      setState(null);
      return null;
    }
  }, [account, network]);

  /**
   * A step finishes when the chain says so, not when the wallet stops talking.
   *
   * Every action here returns before its transaction is included - a paymaster
   * hands back a hash the moment it accepts, a relayer the moment it submits -
   * so reading balances once straight afterwards reads the state from before.
   * That looked like the screen was stuck a step behind and only caught up
   * when the reader pressed Recheck themselves.
   */
  const settle = useCallback(
    async (done: (snapshot: NonNullable<typeof state>) => boolean) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const next = await refresh();
        if (next && done(next)) return;
        setBusy("Confirming on Starknet");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    },
    [refresh],
  );

  /* Reading the chain is the external system here; the state it writes is a
     cache of it, not a render input derived from other state. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /* Read off the chain rather than remembered, so a reload or a step taken
     somewhere else lands the user in the right place. */
  const current: StepId = !state
    ? "bridge"
    : state.registered
      ? "done"
      : state.usdc < ONBOARDING_MIN_USDC && state.strk < ACTIVATION_STRK
        ? "bridge"
        : !session
          ? "deploy"
          : state.strk < ACTIVATION_STRK
            ? "strk"
            : "activate";

  async function run(step: StepId) {
    setError(null);
    try {
      /* Approve, burn, wait for Circle, then hand the attestation to the
         relayer to deliver. The last step is the reason this can be the first
         thing a new wallet does: the mint is paid for by us, and the account
         it credits does not have to exist yet. */
      if (step === "bridge") {
        if (!account) throw new Error("Still deriving your Starknet address");
        const value = parseUsdc(amount);
        if (!value) throw new Error("Enter a USDC amount");
        const { transactionHash, deliveredAtLeast } = await bridgeUsdcFromBase({
          network,
          amount: value,
          destination: account,
          usdc: baseUsdc,
          messenger,
          baseChainId: baseChain.id,
          currentChainId: evmChainId,
          baseBalance,
          switchChain: (chainId) => switchChainAsync({ chainId }),
          writeContract: (config) => writeContractAsync(config as never),
          onProgress: setBusy,
          onBurn: (hash) =>
            toast.success("Sent from Base", {
              action: {
                label: "Basescan",
                onClick: () =>
                  window.open(
                    `${cctp.explorer}/tx/${hash}`,
                    "_blank",
                    "noopener,noreferrer",
                  ),
              },
            }),
        });
        toast.success("USDC arrived on Starknet", {
          description: "MorokPay paid the delivery fee",
          action: transactionHash
            ? {
                label: "Voyager",
                onClick: () =>
                  window.open(
                    `${starknet.explorer}/tx/${transactionHash}`,
                    "_blank",
                    "noopener,noreferrer",
                  ),
              }
            : undefined,
        });
        await settle((snapshot) => snapshot.usdc >= deliveredAtLeast);
      }

      /* Runs here rather than sending the reader to Get STRK. It is the same
         call either way, and a page change at this point loses the session and
         drops them back at a connect button. */
      if (step === "strk") {
        if (!session || !state) throw new Error("Connect your wallet first");
        const gasless = session.kind === "evm" && state.strk < SWAP_GAS_STRK;
        /* The paymaster bills the same USDC the swap is spending, so what is
           sold and what pays to submit it come out of one balance and have to
           fit in it together. Selling a flat dollar out of a 1.99 balance left
           less behind than the gas ceiling, and the paymaster refused to relay
           a transaction the account could not visibly cover. */
        const gasBudget = gasless ? ONBOARDING_SWAP_GAS_USDC : BigInt(0);
        const spare = state.usdc > gasBudget ? state.usdc - gasBudget : BigInt(0);
        const spend = spare < ONBOARDING_SWAP_USDC ? spare : ONBOARDING_SWAP_USDC;
        if (spend <= BigInt(0)) {
          throw new Error(
            "Not enough USDC left to buy STRK and pay for the swap.",
          );
        }
        const hash = await swapUsdcToStrk({
          network,
          session: { address: session.address, kind: session.kind, account: session.account },
          sellAmount: spend,
          gasless,
          gasBudget,
          onProgress: setBusy,
        });
        toast.success("Bought STRK", {
          action: hash
            ? {
                label: "Voyager",
                onClick: () =>
                  window.open(
                    `${starknet.explorer}/tx/${hash}`,
                    "_blank",
                    "noopener,noreferrer",
                  ),
              }
            : undefined,
        });
        await refreshBalances({ private: false });
        await settle((snapshot) => snapshot.strk >= ACTIVATION_STRK);
      }

      if (step === "deploy") {
        if (!evmAddress) throw new Error("Connect your wallet first");
        setBusy("Confirm ownership in your wallet");
        const signature = await signMessageAsync({ message: OWNERSHIP_MESSAGE });
        setBusy("Creating your Starknet account");
        const response = await fetch("/api/privacy-sdk/deploy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ evmAddress, signature, network }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "The account was not created");
        toast.success("Starknet account created");
        await settle((snapshot) => snapshot.deployed);
        await connectEvm();
      }

      if (step === "activate") {
        if (!session || session.kind !== "evm" || !evmAddress || !evmChainId) {
          throw new Error("Connect your wallet first");
        }
        await registerEvmAccount({
          network,
          accountAddress: session.address,
          evmAddress,
          evmChainId,
          signTypedData: (typedData) => signTypedDataAsync(typedData as never),
          onProgress: (message) => setBusy(String(message)),
        });
        toast.success("Privacy activated");
        await settle((snapshot) => snapshot.registered);
        await connectEvm();
        await refreshBalances();
      }
      await refresh();
    } catch (caught) {
      setError(describeError(caught) || "That step did not finish");
    } finally {
      setBusy(null);
    }
  }

  const action =
    current === "done" ? null : (
      <Button
        type="button"
        size="lg"
        className="min-h-12 w-full"
        disabled={Boolean(busy)}
        aria-busy={Boolean(busy)}
        onClick={() => void run(current)}
      >
        {busy ? <Spinner data-icon="inline-start" /> : null}
        {current === "bridge"
          ? "Send USDC from Base"
          : current === "deploy"
            ? "Create my account"
            : current === "strk"
              ? "Buy STRK with USDC"
              : "Activate privacy"}
      </Button>
    );

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Start with private USDC</CardTitle>
        <CardDescription>
          From an Ethereum wallet and nothing else. No Starknet wallet, no seed
          phrase, and no buying STRK by hand - each step below says who pays for
          it.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!isConnected ? (
          <p className="text-sm text-muted-foreground">
            Connect an EVM wallet to begin.
          </p>
        ) : (
          <>
            <div className="rounded-xl bg-muted/40 px-3 py-3 ring-1 ring-foreground/10">
              <p className="text-xs text-muted-foreground">Your Starknet account</p>
              {/* Worth copying rather than reading off the screen: sending
                  USDC or STRK straight here is a supported way through the
                  first two steps, and a hand-typed felt is a lost transfer. */}
              <div className="mt-1 flex items-start gap-2">
                <p className="min-w-0 flex-1 break-all font-mono text-xs">
                  {account ? account : "deriving…"}
                </p>
                {account ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0"
                    aria-label="Copy your Starknet address"
                    title="Copy address"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(account)
                        .then(() => toast.success("Address copied"))
                        .catch(() => toast.error("Could not copy the address"));
                    }}
                  >
                    <CopyIcon />
                  </Button>
                ) : null}
              </div>
              {state ? (
                <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
                  {formatUsdc(state.usdc)} USDC · {formatStrk(state.strk)} STRK
                  {state.registered ? " · privacy on" : ""}
                </p>
              ) : null}
            </div>

            <ol className="flex flex-col gap-2">
              {STEPS.map((step) => {
                const done =
                  STEPS.findIndex((s) => s.id === step.id) <
                  STEPS.findIndex((s) => s.id === current);
                const active = step.id === current;
                return (
                  <li
                    key={step.id}
                    className={
                      active
                        ? "rounded-xl bg-accent/40 px-3 py-3 ring-1 ring-primary/30"
                        : "px-3 py-2"
                    }
                  >
                    <div className="flex items-start gap-2">
                      {done || current === "done" ? (
                        <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                      ) : (
                        <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{step.title}</p>
                        {active || done ? (
                          <p className="text-xs text-muted-foreground">
                            {step.detail}
                          </p>
                        ) : null}
                        {/* The control for a step belongs to that step. The
                            bridge amount used to sit below the whole list,
                            which put the button four steps away from the line
                            it acts on. */}
                        {active ? (
                          <div className="mt-2 flex flex-col gap-2">
                            {step.id === "bridge" ? (
                              <Field>
                                <FieldLabel htmlFor="start-amount">
                                  USDC to bring over
                                </FieldLabel>
                                <Input
                                  id="start-amount"
                                  value={amount}
                                  inputMode="decimal"
                                  onChange={(event) =>
                                    setAmount(event.target.value)
                                  }
                                />
                                <FieldDescription>
                                  {baseBalance !== undefined
                                    ? `${formatUsdc(baseBalance)} USDC on Base in this wallet. `
                                    : ""}
                                  Two dollars covers activation and a
                                  withdrawal later. Already hold USDC on
                                  Starknet? Send it to the address above
                                  instead - this screen will notice.
                                </FieldDescription>
                              </Field>
                            ) : null}
                            {action}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Naming the next pages was not the same as offering them: the
                last step of the way in used to end on a sentence, leaving
                someone who had just finished to find the nav themselves. */}
            {current === "done" ? (
              <Alert>
                <AlertTitle>Ready</AlertTitle>
                <AlertDescription className="flex flex-col gap-3">
                  <span>
                    This account can receive private USDC. Publish a donation
                    QR of your own, or open someone else&apos;s link to pay it.
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      nativeButton={false}
                      render={<Link href="/sell" />}
                    >
                      Create my donation QR
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      nativeButton={false}
                      render={<Link href="/pay" />}
                    >
                      Pay someone
                    </Button>
                  </span>
                </AlertDescription>
              </Alert>
            ) : null}

            {busy ? (
              <Alert>
                <AlertTitle className="flex items-center gap-2">
                  <Spinner />
                  {busy}
                </AlertTitle>
                <AlertDescription>Keep this tab open.</AlertDescription>
              </Alert>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>That step did not finish</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </>
        )}
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-2 border-t">
        {!isConnected ? (
          <Button
            type="button"
            size="lg"
            className="min-h-12"
            disabled={evmConnecting}
            onClick={() => void connectEvm()}
          >
            {evmConnecting ? <Spinner data-icon="inline-start" /> : null}
            Connect an EVM wallet
          </Button>
        ) : null}

        {account ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void refresh()}
            >
              Recheck {shortenAddress(account)}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              <a
                className="underline underline-offset-4"
                href={`${starknet.explorer}/contract/${account}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                See this account on Voyager
              </a>
            </p>
          </>
        ) : null}
      </CardFooter>
    </Card>
  );
}
