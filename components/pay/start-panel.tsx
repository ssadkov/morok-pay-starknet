"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CircleIcon } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useSignMessage, useSignTypedData } from "wagmi";

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
import { OWNERSHIP_MESSAGE } from "@/lib/privacy/eth712-account";
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

/** Enough USDC to buy the STRK activation costs, with room over. */
const MIN_USDC = BigInt(2) * BigInt(10) ** BigInt(6);
/** The pool fee plus gas for the activation the user pays for. */
const ACTIVATION_STRK = BigInt(11) * BigInt(10) ** BigInt(18);

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
  const { network, starknet } = useNetwork();
  const { address: evmAddress, chainId: evmChainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();

  const [state, setState] = useState<{
    usdc: bigint;
    strk: bigint;
    deployed: boolean;
    registered: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("2");

  const account = session?.address ?? evmStarknetAddress;

  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      const [snapshot, registration] = await Promise.all([
        getAccountSnapshot(account, network),
        poolRegistration(network, account),
      ]);
      setState({
        usdc: snapshot.usdcRaw,
        strk: snapshot.strkWei,
        deployed: Boolean(session) || snapshot.strkWei > BigInt(0),
        registered: registration === "registered",
      });
    } catch {
      setState(null);
    }
  }, [account, network, session]);

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
      : state.usdc < MIN_USDC && state.strk < ACTIVATION_STRK
        ? "bridge"
        : !session
          ? "deploy"
          : state.strk < ACTIVATION_STRK
            ? "strk"
            : "activate";

  async function run(step: StepId) {
    setError(null);
    try {
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
              <p className="mt-1 break-all font-mono text-xs">
                {account ? account : "deriving…"}
              </p>
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
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {current === "bridge" ? (
              <Field>
                <FieldLabel htmlFor="start-amount">USDC to bring over</FieldLabel>
                <Input
                  id="start-amount"
                  value={amount}
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value)}
                />
                <FieldDescription>
                  Two dollars covers activation and a withdrawal later. Send it
                  to the address above from an exchange that supports Starknet,
                  or bridge it from Base on the Top up page.
                </FieldDescription>
              </Field>
            ) : null}

            {current === "done" ? (
              <Alert>
                <AlertTitle>Ready</AlertTitle>
                <AlertDescription>
                  This account can receive private USDC. Create a donation QR on
                  My QR, or open someone else&apos;s link to pay one.
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
        ) : current === "strk" ? (
          <Button
            nativeButton={false}
            size="lg"
            className="min-h-12"
            render={<a href="/swap" />}
          >
            Buy STRK with USDC
          </Button>
        ) : current !== "bridge" && current !== "done" ? (
          <Button
            type="button"
            size="lg"
            className="min-h-12"
            disabled={Boolean(busy)}
            aria-busy={Boolean(busy)}
            onClick={() => void run(current)}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {current === "deploy" ? "Create my account" : "Activate privacy"}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
        >
          {account ? `Recheck ${shortenAddress(account)}` : "Recheck"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Explorer:{" "}
          <a
            className="underline underline-offset-4"
            href={account ? `${starknet.explorer}/contract/${account}` : "#"}
            target="_blank"
            rel="noopener noreferrer"
          >
            this account
          </a>
        </p>
      </CardFooter>
    </Card>
  );
}
