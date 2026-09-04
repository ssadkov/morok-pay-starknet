"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ConnectWalletChoices } from "@/components/pay/connect-wallet-choices";
import { QrCode } from "@/components/pay/qr-code";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { parseUsdc } from "@/lib/amount";
import { recordActivity } from "@/lib/pay/activity";
import { claimUrl, computeEscrowCommitment, randomSecret } from "@/lib/pay/escrow";
import { depositToEscrow } from "@/lib/starknet/actions";
import { extractTxHash, formatStrk20Error } from "@/lib/starknet/errors";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

/**
 * Park private USDC behind a one-time link.
 *
 * The counterpart to /claim, and the half that has had no UI since claim-link
 * creation was taken out of the donation flow. It exists again because the
 * claim side is now worth showing: whoever opens the link collects with
 * MetaMask alone - no Starknet wallet, no STRK, MorokPay pays.
 */
export function StashPanel() {
  const { network, starknet } = useNetwork();
  const { session, balances, refreshBalances } = useTreasury();
  const [amount, setAmount] = useState("");
  const [parking, setParking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const privateUsdc = balances?.privateUsdc ?? BigInt(0);

  async function handlePark() {
    if (!session || !starknet.escrow) return;
    setError(null);
    setParking(true);
    try {
      const parsed = parseUsdc(amount.trim());
      if (parsed <= BigInt(0)) throw new Error("Enter an amount to park");
      if (parsed > privateUsdc) {
        throw new Error(
          `This account holds ${formatUsdc(privateUsdc)} private USDC, less than the ${formatUsdc(parsed)} you are parking.`,
        );
      }

      const secret = randomSecret();
      const usdc = getShieldToken("usdc", network);
      const response = await depositToEscrow(
        session.account,
        usdc,
        parsed,
        starknet.escrow,
        computeEscrowCommitment(secret),
      );
      const txHash = extractTxHash(response);

      /* Only now, once the pool has actually moved the money - a link handed
         out before the deposit lands is a link to nothing. */
      setLink(claimUrl(window.location.origin, { network, secret }));
      recordActivity({
        network,
        kind: "pay",
        source: "morok",
        status: "confirmed",
        amount: formatUsdc(parsed),
        amountRaw: parsed.toString(),
        label: "Parked in escrow",
        address: starknet.escrow,
        txHash,
      });
      if (txHash) {
        txToast({
          title: "Parked. The link below claims it.",
          txHash,
          explorerUrl: `${starknet.explorer}/tx/${txHash}`,
          explorerLabel: "Voyager",
        });
      } else {
        toast.success("Parked. The link below claims it.");
      }
      await refreshBalances({ private: true });
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setParking(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Park it behind a link</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Move private USDC into escrow behind a one-time secret. Whoever opens
          the link collects it with MetaMask alone - no Starknet wallet, no
          STRK, and MorokPay pays for their transaction.
        </p>
      </div>
      <TestnetHint />
      {!session ? <ConnectWalletChoices /> : null}

      {!starknet.escrow ? (
        <Alert variant="destructive">
          <AlertTitle>No escrow on this network</AlertTitle>
          <AlertDescription>
            The helper is deployed on Sepolia. Switch the header to Sepolia to
            try this.
          </AlertDescription>
        </Alert>
      ) : link ? (
        <Card>
          <CardHeader>
            <CardTitle>One link, one claim</CardTitle>
            <CardDescription>
              Anyone holding this link can collect the money, and it works
              exactly once. Send it through a channel you trust, and keep a
              copy until it is claimed - it is not shown again.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex justify-center">
              <QrCode value={link} label="Claim link" />
            </div>
            <code className="block overflow-x-auto rounded-lg bg-muted p-3 text-xs">
              {link}
            </code>
          </CardContent>
          <CardFooter className="flex gap-3 border-t">
            <Button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(link)
                  .then(() => toast.success("Link copied"))
                  .catch(() => toast.error("Could not copy - select it by hand"));
              }}
            >
              Copy link
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLink(null);
                setAmount("");
              }}
            >
              Park another
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Amount</CardTitle>
            <CardDescription>
              {session
                ? `${formatUsdc(privateUsdc)} private USDC available.`
                : "Connect a wallet with a private USDC balance."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="stash-amount">USDC to park</Label>
              <Input
                id="stash-amount"
                inputMode="decimal"
                placeholder="1.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not park it</AlertTitle>
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
                disabled={parking || !amount.trim()}
                aria-busy={parking}
                onClick={() => {
                  void handlePark();
                }}
              >
                {parking ? <Spinner data-icon="inline-start" /> : null}
                {parking ? "Parking" : "Park and make a link"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect a wallet above to park.
              </p>
            )}
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
