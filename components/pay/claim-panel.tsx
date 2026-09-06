"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useSignMessage } from "wagmi";

import { ConnectWalletChoices } from "@/components/pay/connect-wallet-choices";
import { TestnetHint } from "@/components/pay/testnet-hint";
import { txToast } from "@/components/pay/tx-toast";
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
import { Spinner } from "@/components/ui/spinner";
import { recordActivity } from "@/lib/pay/activity";
import {
  computeEscrowCommitment,
  parseClaimRequest,
} from "@/lib/pay/escrow";
import {
  commitmentFromSeed,
  parseClaimV2Request,
  type ClaimV2Request,
} from "@/lib/pay/escrow-v2";
import { claimEscrowV2 } from "@/lib/privacy/escrow-claim-client";
import { OWNERSHIP_MESSAGE } from "@/lib/privacy/eth712-account";
import { claimFromEscrow } from "@/lib/starknet/actions";
import { extractTxHash, formatStrk20Error } from "@/lib/starknet/errors";
import { readEscrowEntry } from "@/lib/starknet/escrow";
import {
  escrowV2Status,
  readEscrowV2Entry,
  type EscrowV2Status,
} from "@/lib/starknet/escrow-v2";
import { createProvider, formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

export function ClaimPanel() {
  const searchParams = useSearchParams();
  const { network } = useNetwork();
  const v2 = parseClaimV2Request(searchParams, network);
  const v1 = v2 ? null : parseClaimRequest(searchParams, network);
  if (v2) return <ClaimV2Panel request={v2} />;
  return <ClaimV1Panel request={v1} />;
}

function ClaimV2Panel({ request }: { request: ClaimV2Request }) {
  const { network, setNetwork, starknet } = useNetwork();
  const { session } = useTreasury();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<EscrowV2Status | null>(null);
  const [claimTx, setClaimTx] = useState<string | null>(null);

  useEffect(() => {
    if (request.network !== network) setNetwork(request.network);
  }, [request.network, network, setNetwork]);

  useEffect(() => {
    if (!starknet.escrowV2) return;
    let cancelled = false;
    const commitment = commitmentFromSeed(request.seed);
    void (async () => {
      try {
        const entry = await readEscrowV2Entry({
          network: request.network,
          commitment,
        });
        const now = BigInt(
          (await createProvider(request.network).getBlock("latest")).timestamp,
        );
        if (!cancelled) setStatus(escrowV2Status(entry, now));
      } catch {
        // Leave status null until RPC answers.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, starknet.escrowV2]);

  async function handleClaim() {
    if (!session) return;
    setError(null);
    setClaiming(true);
    try {
      const result = await claimEscrowV2({
        network: request.network,
        seed: request.seed,
        destination: session.address,
      });
      setClaimTx(result.transactionHash);
      setStatus({ state: "claimed" });
      const amount =
        request.amount ??
        (status?.state === "claimable" ? formatUsdc(status.entry.amount) : "0");
      recordActivity({
        network: request.network,
        kind: "receive",
        source: "morok",
        status: "confirmed",
        amount,
        amountRaw:
          status?.state === "claimable" ? status.entry.amount.toString() : undefined,
        label: "Claim V2",
        address: session.address,
        txHash: result.transactionHash,
      });
      txToast({
        title: "Claimed to your public Starknet balance",
        txHash: result.transactionHash,
        explorerUrl: `${starknet.explorer}/tx/${result.transactionHash}`,
        explorerLabel: "Voyager",
      });
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setClaiming(false);
    }
  }

  const displayAmount =
    status?.state === "claimable"
      ? formatUsdc(status.entry.amount)
      : request.amount
        ? request.amount
        : "…";

  const blocked = status?.state === "missing" || status?.state === "claimed";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Claim with MetaMask</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Connect MetaMask. The link authorises the payout; MorokPay pays gas.
          Tokens land as a public balance on your derived Starknet account —
          not a private note. Expiry only lets the sender reclaim too — this
          link still works until one of you takes it.
        </p>
      </div>
      <TestnetHint />
      {!session ? <ConnectWalletChoices sponsored /> : null}

      {!starknet.escrowV2 ? (
        <Alert variant="destructive">
          <AlertTitle>No escrow V2 on this network</AlertTitle>
          <AlertDescription>Switch to Sepolia to claim this link.</AlertDescription>
        </Alert>
      ) : status?.state === "missing" ? (
        <Alert variant="destructive">
          <AlertTitle>Nothing parked under this link</AlertTitle>
          <AlertDescription>
            The sender may not have funded it yet, or this is the wrong network.
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{displayAmount} USDC</CardTitle>
            <CardDescription>
              {status?.state === "claimed"
                ? "Already claimed."
                : status?.state === "claimable" && status.refundable
                  ? "Still claimable. The sender can also reclaim now — first exit wins."
                  : "Waiting in escrow. One MetaMask connection is enough."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not claim</AlertTitle>
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
                disabled={claiming || blocked || status === null}
                aria-busy={claiming}
                onClick={() => {
                  void handleClaim();
                }}
              >
                {claiming ? <Spinner data-icon="inline-start" /> : null}
                {status?.state === "claimed"
                  ? "Claimed"
                  : claiming
                    ? "Claiming"
                    : "Claim to my account"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect a wallet above to claim.
              </p>
            )}
          </CardFooter>
          {claimTx ? (
            <CardFooter className="border-t">
              <p className="text-sm text-muted-foreground">
                Receipt:{" "}
                <a
                  className="underline underline-offset-4"
                  href={`${starknet.explorer}/tx/${claimTx}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {`${claimTx.slice(0, 10)}…${claimTx.slice(-6)}`}
                </a>
              </p>
            </CardFooter>
          ) : null}
        </Card>
      )}
    </div>
  );
}

function ClaimV1Panel({
  request,
}: {
  request: ReturnType<typeof parseClaimRequest>;
}) {
  const { network, setNetwork, starknet } = useNetwork();
  const {
    session,
    refreshBalances,
    evmConnectedAddress,
    evmGate,
    connectEvm,
    signatureProgress,
  } = useTreasury();
  const { signMessageAsync } = useSignMessage();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onChainAmount, setOnChainAmount] = useState<bigint | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [claimTx, setClaimTx] = useState<string | null>(null);

  useEffect(() => {
    if (request && request.network !== network) {
      setNetwork(request.network);
    }
  }, [request, network, setNetwork]);

  useEffect(() => {
    if (!request || !starknet.escrow) return;
    let cancelled = false;
    const commitment = computeEscrowCommitment(request.secret);
    readEscrowEntry({ network, commitment })
      .then((entry) => {
        if (cancelled) return;
        if (!entry) {
          setMissing(true);
          return;
        }
        setOnChainAmount(entry.amount);
        setClaimed(entry.claimed);
      })
      .catch(() => {
        // Leave the link amount as a fallback until the RPC answers.
      });
    return () => {
      cancelled = true;
    };
  }, [request, network, starknet.escrow]);

  async function handleCreateAccount() {
    if (!request || !evmConnectedAddress) return;
    setError(null);
    setCreating(true);
    try {
      const signature = await signMessageAsync({ message: OWNERSHIP_MESSAGE });
      const response = await fetch("/api/privacy-sdk/deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          evmAddress: evmConnectedAddress,
          signature,
          network,
          claimCommitment: computeEscrowCommitment(request.secret),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "The account was not created");
      }
      toast.success("Account created. Claiming is the next button.");
      await connectEvm();
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setCreating(false);
    }
  }

  async function handleClaim() {
    if (!session || !request || !starknet.escrow) return;
    setError(null);
    setClaiming(true);
    try {
      const usdc = getShieldToken("usdc", network);
      const sponsored = session.kind === "evm";
      const response = await claimFromEscrow(
        session.account,
        usdc,
        session.address,
        starknet.escrow,
        request.secret,
        sponsored
          ? { register: !session.privacyReady, relay: true }
          : undefined,
      );
      const txHash = extractTxHash(response);
      const amount = request.amount ?? (onChainAmount ? formatUsdc(onChainAmount) : "0");
      recordActivity({
        network,
        kind: "receive",
        source: "morok",
        status: "confirmed",
        amount,
        amountRaw: onChainAmount?.toString(),
        label: "Claim",
        address: session.address,
        txHash,
      });
      setClaimed(true);
      if (txHash) setClaimTx(txHash);
      if (txHash) {
        txToast({
          title: "Claimed into your private wallet",
          txHash,
          explorerUrl: `${starknet.explorer}/tx/${txHash}`,
          explorerLabel: "Voyager",
        });
      } else {
        toast.success("Claimed into your private wallet");
      }
      await connectEvm();
      await refreshBalances({ private: true });
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setClaiming(false);
    }
  }

  const needsAccount =
    Boolean(evmConnectedAddress) && evmGate?.reason === "undeployed";

  const displayAmount =
    onChainAmount !== null
      ? formatUsdc(onChainAmount)
      : request?.amount
        ? request.amount
        : "…";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Claim privately</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          The link holds a secret, not an address. Connect MetaMask and the
          parked USDC lands in your own private note - no Starknet wallet, no
          STRK, and MorokPay pays for the transaction. Ready X works too, and
          pays its own way.
        </p>
      </div>
      <TestnetHint />
      {!session ? <ConnectWalletChoices sponsored /> : null}

      {!request ? (
        <Alert>
          <AlertTitle>No claim in this link</AlertTitle>
          <AlertDescription>
            Ask the sender for a MorokPay claim QR. A regular payment link
            goes to Pay, not here.
          </AlertDescription>
        </Alert>
      ) : missing ? (
        <Alert variant="destructive">
          <AlertTitle>Nothing parked under this secret</AlertTitle>
          <AlertDescription>
            The sender may not have funded it yet, or this is the wrong
            network.
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{displayAmount} USDC</CardTitle>
            <CardDescription>
              {claimed
                ? "Already claimed."
                : "Waiting in escrow. Claiming registers you if needed."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not claim</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="border-t">
            {session ? (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  size="lg"
                  className="min-h-10"
                  disabled={claiming || claimed}
                  aria-busy={claiming}
                  onClick={() => {
                    void handleClaim();
                  }}
                >
                  {claiming ? <Spinner data-icon="inline-start" /> : null}
                  {claimed
                    ? "Claimed"
                    : claiming
                      ? signatureProgress
                        ? `Signature ${signatureProgress.step} of ${signatureProgress.total}`
                        : "Claiming"
                      : "Claim into private USDC"}
                </Button>
                {claiming ? (
                  <p className="text-xs text-muted-foreground">
                    {signatureProgress
                      ? signatureProgress.label
                      : "Proving and submitting - this takes up to a minute, and MorokPay pays for it."}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect a wallet above to claim.
              </p>
            )}
          </CardFooter>
          {claimTx ? (
            <CardFooter className="border-t">
              <p className="text-sm text-muted-foreground">
                Receipt:{" "}
                <a
                  className="underline underline-offset-4"
                  href={`${starknet.explorer}/tx/${claimTx}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {`${claimTx.slice(0, 10)}…${claimTx.slice(-6)}`}
                </a>
              </p>
            </CardFooter>
          ) : null}
          {needsAccount ? (
            <CardFooter className="flex flex-col items-start gap-3 border-t">
              <p className="text-sm text-muted-foreground">
                This wallet has no Starknet account yet. MorokPay creates it
                and pays for it, because there is money here waiting for you.
              </p>
              <Button
                type="button"
                variant="outline"
                className="min-h-10"
                disabled={creating}
                aria-busy={creating}
                onClick={() => {
                  void handleCreateAccount();
                }}
              >
                {creating ? <Spinner data-icon="inline-start" /> : null}
                {creating ? "Creating" : "Create my account"}
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      )}
    </div>
  );
}
