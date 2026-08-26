"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { ConnectPanel } from "@/components/treasury/connect-panel";
import { TestnetHint } from "@/components/pay/testnet-hint";
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
import { claimFromEscrow } from "@/lib/starknet/actions";
import { extractTxHash, formatStrk20Error } from "@/lib/starknet/errors";
import { readEscrowEntry } from "@/lib/starknet/escrow";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

export function ClaimPanel() {
  const searchParams = useSearchParams();
  const { network, setNetwork, starknet } = useNetwork();
  const { session, refreshBalances } = useTreasury();
  const request = parseClaimRequest(searchParams, network);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onChainAmount, setOnChainAmount] = useState<bigint | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [missing, setMissing] = useState(false);

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

  async function handleClaim() {
    if (
      !session ||
      session.kind !== "ready" ||
      !request ||
      !starknet.escrow
    ) return;
    setError(null);
    setClaiming(true);
    try {
      const usdc = getShieldToken("usdc", network);
      const response = await claimFromEscrow(
        session.account,
        usdc,
        session.address,
        starknet.escrow,
        request.secret,
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
      toast.success("Claimed into your private wallet", {
        description: txHash,
      });
      await refreshBalances({ private: true });
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setClaiming(false);
    }
  }

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
          The link holds a secret, not an address. Connect Ready, let it
          register you in the pool, then pull the parked USDC into your own
          note.
        </p>
      </div>
      <TestnetHint />
      {!session ? <ConnectPanel /> : null}

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
                Connect Ready above to claim.
              </p>
            )}
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
