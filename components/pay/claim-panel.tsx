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
import { OWNERSHIP_MESSAGE } from "@/lib/privacy/eth712-account";
import {
  computeEscrowCommitment,
  parseClaimRequest,
} from "@/lib/pay/escrow";
import { claimFromEscrow } from "@/lib/starknet/actions";
import { extractTxHash, formatStrk20Error } from "@/lib/starknet/errors";
import { readEscrowEntry } from "@/lib/starknet/escrow";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

export function ClaimPanel() {
  const searchParams = useSearchParams();
  const { network, setNetwork, starknet } = useNetwork();
  const {
    session,
    refreshBalances,
    evmConnectedAddress,
    evmGate,
    connectEvm,
  } = useTreasury();
  const { signMessageAsync } = useSignMessage();
  const request = parseClaimRequest(searchParams, network);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onChainAmount, setOnChainAmount] = useState<bigint | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [creating, setCreating] = useState(false);

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

  /**
   * Create the claimer's Starknet account, on MorokPay.
   *
   * This used to send them to /start, which is the wrong door: that flow
   * exists for somebody funding themselves and opens by asking for two
   * dollars of USDC to bridge. A claimer is not funding anything - the money
   * is already parked - so the only step they need is the deploy, and the
   * commitment is what tells the server to pay for it.
   */
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
      /* On the EVM rail a claimer who has never touched Starknet can be
         registered inside this same action set, and MorokPay submits and pays
         for it - so collecting needs no STRK and no Starknet wallet. Ready X
         registers itself and pays its own way, so neither applies there. */
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
      await refreshBalances({ private: true });
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setClaiming(false);
    }
  }

  /* The gate is the context's own read of the chain, so this button appears
     for exactly the wallet that cannot claim yet and disappears once the
     deploy lands. */
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
                {claimed ? "Claimed" : claiming ? "Claiming" : "Claim into private USDC"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect a wallet above to claim.
              </p>
            )}
          </CardFooter>
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
