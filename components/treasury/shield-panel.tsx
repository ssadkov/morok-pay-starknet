"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldIcon } from "lucide-react";

import { useNetwork } from "@/components/network-provider";
import { TokenPicker } from "@/components/treasury/token-picker";
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
import { parseTokenAmount } from "@/lib/amount";
import { recordActivity } from "@/lib/pay/activity";
import { shieldToken } from "@/lib/starknet/actions";
import { formatStrk20Error } from "@/lib/starknet/errors";
import { formatShieldAmount } from "@/lib/starknet/status";

export function ShieldPanel() {
  const { session, token, publicRaw, privateRaw, refreshBalances } =
    useTreasury();
  const { network, starknet } = useNetwork();
  const [amount, setAmount] = useState("");
  const [shielding, setShielding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;
  const ready = session;

  async function handleShield() {
    setError(null);
    setShielding(true);
    try {
      const parsed = amount.trim()
        ? parseTokenAmount(amount, token.decimals)
        : publicRaw;
      const response = await shieldToken(ready.account, token, parsed);
      if (token.id === "usdc") {
        recordActivity({
          network,
          kind: "shield",
          source: "morok",
          amount: formatShieldAmount(parsed, token),
          amountRaw: parsed.toString(),
          address: ready.address,
          txHash: response.transaction_hash,
        });
      }
      toast.success(`${token.symbol} shielded`, {
        description: response.transaction_hash,
        action: {
          label: "Voyager",
          onClick: () =>
            window.open(
              `${starknet.explorer}/tx/${response.transaction_hash}`,
              "_blank",
              "noopener,noreferrer",
            ),
        },
      });
      setAmount("");
      await refreshBalances();
    } catch (caught) {
      setError(formatStrk20Error(caught, "shield"));
    } finally {
      setShielding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shield into STRK20</CardTitle>
        <CardDescription>
          Ready X deposits public {token.symbol} into the official pool. The
          deposit amount is visible; the remaining private notes are not.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TokenPicker
          labelledBy="shield-token-label"
          onTokenChange={() => {
            setAmount("");
            setError(null);
          }}
        />
        <p className="text-sm text-muted-foreground">
          Private balance: {formatShieldAmount(privateRaw, token)} {token.symbol}
        </p>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="shield-amount">Amount</FieldLabel>
            <Input
              id="shield-amount"
              inputMode="decimal"
              placeholder={
                publicRaw > BigInt(0)
                  ? formatShieldAmount(publicRaw, token)
                  : "0.00"
              }
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <FieldDescription>
              Leave empty to shield the full public {token.symbol} balance (
              {formatShieldAmount(publicRaw, token)}).
            </FieldDescription>
          </Field>
        </FieldGroup>
        {publicRaw === BigInt(0) ? (
          <Alert>
            <AlertTitle>No public {token.symbol} to shield</AlertTitle>
            <AlertDescription>
              {token.id === "strkbtc"
                ? "Bridge BTC at strkbtc.io or swap on AVNU, then shield."
                : network === "sepolia"
                  ? "Fund this Ready X address from Base Sepolia first, then shield. Pool fee on Sepolia is 2 STRK."
                  : "Fund this Ready X address from Base first, then shield."}
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Shield failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          size="lg"
          className="min-h-10"
          disabled={shielding || publicRaw === BigInt(0)}
          aria-busy={shielding}
          onClick={() => {
            void handleShield();
          }}
        >
          {shielding ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ShieldIcon data-icon="inline-start" />
          )}
          {shielding ? "Shielding" : `Shield ${token.symbol}`}
        </Button>
      </CardFooter>
    </Card>
  );
}
