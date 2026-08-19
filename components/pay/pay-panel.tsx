"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { TestnetHint } from "@/components/pay/testnet-hint";
import { ConnectPanel } from "@/components/treasury/connect-panel";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseUsdc } from "@/lib/amount";
import {
  recordActivity,
  removeActivity,
  sameAddress,
  updateActivity,
} from "@/lib/pay/activity";
import { isCommitment } from "@/lib/pay/commitment";
import { parsePaymentLink, parsePaymentRequest } from "@/lib/pay/request";
import { transferPrivate } from "@/lib/starknet/actions";
import {
  extractTxHash,
  formatStrk20Error,
  isUserRefused,
} from "@/lib/starknet/errors";
import {
  currentBlock,
  waitForInvoiceSettlement,
} from "@/lib/starknet/invoice-events";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";
import { shortenAddress } from "@/lib/format";

type PayOutcome =
  | { kind: "hash"; txHash?: string }
  | { kind: "error"; error: unknown };

export function PayPanel() {
  const searchParams = useSearchParams();
  const { network, setNetwork, starknet } = useNetwork();
  const {
    session,
    privateRaw,
    balancesLoading,
    refreshBalances,
  } = useTreasury();
  const usdc = getShieldToken("usdc", network);
  const fromQuery = useMemo(
    () => parsePaymentRequest(searchParams, network),
    [searchParams, network],
  );
  const [pasted, setPasted] = useState("");
  const [fromPaste, setFromPaste] = useState(
    () => parsePaymentLink(pasted, network),
  );
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ready refused the settlement helper once; keep paying without it.
  const [settleFailed, setSettleFailed] = useState(false);

  const request = fromQuery ?? fromPaste;

  // The pool calls `privacy_invoke` after the transfer. With a commitment that
  // lands on MorokInvoices so the merchant can settle the invoice on-chain;
  // older links keep hitting the EchoHelper probe.
  const settleInvoke = useMemo(() => {
    if (!request || settleFailed) return undefined;
    if (starknet.invoices && isCommitment(request.commitment)) {
      return { contract: starknet.invoices, calldata: [request.commitment] };
    }
    return starknet.echoHelper ? { contract: starknet.echoHelper } : undefined;
  }, [request, settleFailed, starknet.invoices, starknet.echoHelper]);
  const settlesOnChain = Boolean(
    !settleFailed && starknet.invoices && isCommitment(request?.commitment),
  );

  useEffect(() => {
    if (fromQuery && fromQuery.network !== network) {
      setNetwork(fromQuery.network);
    }
  }, [fromQuery, network, setNetwork]);

  async function handlePay() {
    if (!session || !request) return;
    setError(null);
    setPaying(true);
    let amount: bigint;
    try {
      amount = parseUsdc(request.amount);
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
      setPaying(false);
      return;
    }
    if (privateRaw < amount) {
      setError(formatStrk20Error(new Error("INSUFFICIENT_PRIVATE_BALANCE"), "pay"));
      setPaying(false);
      return;
    }
    const pending = recordActivity({
      network,
      kind: "pay",
      source: "morok",
      status: "pending",
      amount: request.amount,
      amountRaw: amount.toString(),
      invoice: request.invoice || undefined,
      label: request.label || undefined,
      counterparty: request.to,
      address: session.address,
    });
    const confirm = async (txHash: string | undefined) => {
      updateActivity(pending.id, { txHash, status: "confirmed" });
      toast.success("Paid privately", {
        description: txHash,
        action: txHash
          ? {
              label: "Voyager",
              onClick: () =>
                window.open(
                  `${starknet.explorer}/tx/${txHash}`,
                  "_blank",
                  "noopener,noreferrer",
                ),
            }
          : undefined,
      });
      await refreshBalances({ private: false });
    };

    const giveUp = (caught: unknown) => {
      removeActivity(pending.id);
      setError(formatStrk20Error(caught, "pay"));
    };

    // Ready does not always hand the hash back, so accept the settlement
    // event as proof too — whichever arrives first ends the spinner.
    const submit = async (
      invoke?: { contract: string; calldata?: string[] },
    ): Promise<PayOutcome> => {
      const watched = invoke && settlesOnChain ? request.commitment : undefined;
      const fromBlock = watched ? await currentBlock(network) : undefined;
      const fromWallet = transferPrivate(
        session.account,
        usdc,
        amount,
        request.to,
        invoke,
      ).then(
        (response): PayOutcome => ({
          kind: "hash",
          txHash: extractTxHash(response),
        }),
        (error): PayOutcome => {
          const txHash = extractTxHash(error);
          return txHash ? { kind: "hash", txHash } : { kind: "error", error };
        },
      );
      if (!watched) return fromWallet;

      const fromChain = waitForInvoiceSettlement({
        network,
        commitment: watched,
        fromBlock,
      }).then((settlement) =>
        settlement
          ? ({ kind: "hash", txHash: settlement.txHash } as PayOutcome)
          : null,
      );
      return Promise.race([
        fromWallet,
        fromChain.then((outcome) => outcome ?? fromWallet),
      ]);
    };

    try {
      const outcome = await submit(settleInvoke);
      if (outcome.kind === "hash") {
        await confirm(outcome.txHash);
        return;
      }
      if (isUserRefused(outcome.error) || !settleInvoke) {
        giveUp(outcome.error);
        return;
      }
      // The helper call is the only unusual leg here. Drop it and pay
      // plainly rather than leaving the merchant unpaid.
      console.error("MorokPay: privacy_invoke helper rejected", outcome.error);
      setSettleFailed(true);
      const retry = await submit(undefined);
      if (retry.kind === "hash") {
        await confirm(retry.txHash);
        toast.info("Paid without on-chain settlement", {
          description:
            "Ready refused the invoice helper, so the merchant marks this sale manually.",
        });
      } else {
        giveUp(retry.error);
      }
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Pay privately</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {network === "sepolia"
            ? "Sepolia: send shielded test USDC to a merchant Ready. Pool fee is 2 STRK. The invoice number stays on this request — only its hash is settled on-chain."
            : "Send shielded USDC to a merchant Ready address. The invoice number stays on this request; the pool publishes only its hash so the merchant can match the sale."}
        </p>
      </div>
      <TestnetHint />

      {!fromQuery ? (
        <Card>
          <CardHeader>
            <CardTitle>Open a request</CardTitle>
            <CardDescription>
              Paste a MorokPay payment link if you did not scan a QR.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="pay-link">Payment link</FieldLabel>
                <Input
                  id="pay-link"
                  value={pasted}
                  inputMode="url"
                  placeholder="/pay?to=0x…&amount=12.50&inv=INV-9K2M"
                  onChange={(event) => {
                    const value = event.target.value;
                    setPasted(value);
                    setFromPaste(parsePaymentLink(value, network));
                    setError(null);
                  }}
                />
                <FieldDescription>
                  Ask the merchant for a QR, or paste the link they sent you.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}

      {request ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {request.label || "Private USDC payment"}
            </CardTitle>
            <CardDescription>
              {request.amount} USDC
              {request.invoice ? ` · ${request.invoice}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              To {shortenAddress(request.to)} on Starknet {request.network}.
            </p>
            {settlesOnChain ? (
              <p className="text-sm text-muted-foreground">
                The pool will settle this invoice on-chain, so the merchant sees
                it without asking you for anything. Only a hash is published —
                not the amount, the invoice number, or either address.
              </p>
            ) : null}
            {session ? (
              <p className="text-sm tabular-nums">
                Your private USDC:{" "}
                {balancesLoading && privateRaw === BigInt(0)
                  ? "…"
                  : formatUsdc(privateRaw)}
              </p>
            ) : null}
            {session && sameAddress(request.to, session.address) ? (
              <Alert>
                <AlertTitle>Paying your own Ready</AlertTitle>
                <AlertDescription>
                  This invoice is addressed to the connected account, so
                  Payment wallet USDC will not drop by {request.amount}. Pool
                  fees come from shielded STRK, not USDC. Use a second Ready
                  profile as the merchant to see a real private transfer.
                </AlertDescription>
              </Alert>
            ) : null}
            {privateRaw === BigInt(0) && session ? (
              <Alert>
                <AlertTitle>No private USDC yet</AlertTitle>
                <AlertDescription>
                  <Link href="/treasury" className="underline underline-offset-4">
                    {network === "sepolia"
                      ? "Get test USDC, then shield"
                      : "Top up from Base and shield"}
                  </Link>{" "}
                  before paying.
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not pay</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="border-t">
            {session ? (
              <Button
                type="button"
                size="lg"
                className="min-h-10"
                disabled={paying || privateRaw === BigInt(0)}
                aria-busy={paying}
                onClick={() => {
                  void handlePay();
                }}
              >
                {paying ? <Spinner data-icon="inline-start" /> : null}
                {paying ? "Paying" : `Pay ${request.amount} USDC`}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect Ready above to confirm this payment.
              </p>
            )}
          </CardFooter>
        </Card>
      ) : null}

      {!session ? <ConnectPanel /> : null}
    </div>
  );
}
