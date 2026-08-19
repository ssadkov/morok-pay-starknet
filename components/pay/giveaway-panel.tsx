"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CopyIcon } from "lucide-react";

import { QrCode } from "@/components/pay/qr-code";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseUsdc } from "@/lib/amount";
import { recordActivity } from "@/lib/pay/activity";
import {
  readClaims,
  saveClaim,
  subscribeClaims,
  type EscrowClaim,
} from "@/lib/pay/claims";
import {
  claimUrl,
  computeEscrowCommitment,
  randomSecret,
} from "@/lib/pay/escrow";
import { depositToEscrow } from "@/lib/starknet/actions";
import { extractTxHash, formatStrk20Error } from "@/lib/starknet/errors";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

const EMPTY: EscrowClaim[] = [];

function useClaims(network: ReturnType<typeof useNetwork>["network"]) {
  return useSyncExternalStore(
    subscribeClaims,
    () => readClaims(network),
    () => EMPTY,
  );
}

export function GiveawayPanel() {
  const { network, starknet } = useNetwork();
  const { session, privateRaw, balancesLoading, refreshBalances } = useTreasury();
  const claims = useClaims(network);
  const [amount, setAmount] = useState("0.5");
  const [parking, setParking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<EscrowClaim | null>(null);

  const url = useMemo(() => {
    if (!created || typeof window === "undefined") return "";
    return claimUrl(window.location.origin, created);
  }, [created]);

  if (!starknet.escrow) return null;

  async function copyUrl(value = url) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Claim link copied");
    } catch {
      toast.error("Could not copy link");
    }
  }

  async function handlePark() {
    if (!session || !starknet.escrow) return;
    setError(null);
    setParking(true);
    try {
      const parsed = parseUsdc(amount);
      if (privateRaw < parsed) {
        throw new Error("INSUFFICIENT_PRIVATE_BALANCE");
      }
      const secret = randomSecret();
      const commitment = computeEscrowCommitment(secret);
      const usdc = getShieldToken("usdc", network);
      const response = await depositToEscrow(
        session.account,
        usdc,
        parsed,
        starknet.escrow,
        commitment,
      );
      const txHash = extractTxHash(response);
      const claim: EscrowClaim = {
        network,
        secret,
        commitment,
        amount: amount.trim(),
        createdAt: Date.now(),
        status: "parked",
        txHash,
      };
      saveClaim(claim);
      recordActivity({
        network,
        kind: "pay",
        source: "morok",
        status: "confirmed",
        amount: amount.trim(),
        amountRaw: parsed.toString(),
        label: "Claim link",
        address: session.address,
        txHash,
      });
      setCreated(claim);
      toast.success("USDC parked behind a claim link");
      await refreshBalances({ private: false });
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setParking(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Claim link</CardTitle>
          <CardDescription>
            Park private USDC behind a secret. Anyone with the link can claim
            into their own pool note after they register — they do not need to
            exist on this network yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="giveaway-amount">Amount, USDC</FieldLabel>
              <Input
                id="giveaway-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <FieldDescription>
                Private USDC:{" "}
                {balancesLoading && privateRaw === BigInt(0)
                  ? "…"
                  : formatUsdc(privateRaw)}
              </FieldDescription>
            </Field>
          </FieldGroup>
          {error ? (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>Could not park the claim</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="border-t">
          <Button
            type="button"
            size="lg"
            className="min-h-10"
            disabled={!session || parking || privateRaw === BigInt(0)}
            aria-busy={parking}
            onClick={() => {
              void handlePark();
            }}
          >
            {parking ? <Spinner data-icon="inline-start" /> : null}
            {parking ? "Parking" : "Park a claim link"}
          </Button>
        </CardFooter>
      </Card>

      {created && url ? (
        <Card>
          <CardHeader>
            <CardTitle>{created.amount} USDC claim</CardTitle>
            <CardDescription>
              Share this QR. The secret never goes on-chain — only its hash.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <QrCode value={url} label="Claim QR" />
            <p className="max-w-full break-all text-xs text-muted-foreground">{url}</p>
          </CardContent>
          <CardFooter className="border-t">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-10"
              onClick={() => {
                void copyUrl();
              }}
            >
              <CopyIcon data-icon="inline-start" />
              Copy link
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {claims.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {claims.map((entry) => (
            <li
              key={entry.commitment}
              className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10"
            >
              <button
                type="button"
                className="min-w-0 text-left"
                onClick={() => {
                  setCreated(entry);
                  void copyUrl(
                    claimUrl(window.location.origin, entry),
                  );
                }}
              >
                <p className="text-sm font-medium">
                  {entry.amount} USDC claim
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {entry.commitment.slice(0, 18)}…
                </p>
              </button>
              <Badge>{entry.status === "claimed" ? "Claimed" : "Parked"}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
