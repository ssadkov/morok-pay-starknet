"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldIcon } from "lucide-react";

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
import { EXPLORER_URL } from "@/lib/starknet/constants";
import { shieldUsdc } from "@/lib/starknet/actions";
import { formatUsdc } from "@/lib/starknet/status";

export function ShieldPanel() {
  const { session, balances, refreshBalances } = useTreasury();
  const [amount, setAmount] = useState("");
  const [shielding, setShielding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;
  const ready = session;

  const publicUsdc = balances?.usdcRaw ?? BigInt(0);
  const privateUsdc = balances?.privateUsdc ?? BigInt(0);

  async function handleShield() {
    setError(null);
    setShielding(true);
    try {
      const parsed = amount.trim() ? parseUsdc(amount) : publicUsdc;
      const response = await shieldUsdc(ready.account, parsed);
      toast.success("USDC shielded", {
        description: response.transaction_hash,
        action: {
          label: "Voyager",
          onClick: () =>
            window.open(
              `${EXPLORER_URL}/tx/${response.transaction_hash}`,
              "_blank",
              "noopener,noreferrer",
            ),
        },
      });
      setAmount("");
      await refreshBalances();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Shield failed");
    } finally {
      setShielding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shield into STRK20</CardTitle>
        <CardDescription>
          Ready deposits public USDC into the official pool. The deposit amount
          is visible; the remaining private notes are not.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Private balance: {formatUsdc(privateUsdc)} USDC
        </p>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="shield-amount">Amount</FieldLabel>
            <Input
              id="shield-amount"
              inputMode="decimal"
              placeholder={
                publicUsdc > BigInt(0) ? formatUsdc(publicUsdc) : "0.00"
              }
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <FieldDescription>
              Leave empty to shield the full public USDC balance (
              {formatUsdc(publicUsdc)}).
            </FieldDescription>
          </Field>
        </FieldGroup>
        {publicUsdc === BigInt(0) ? (
          <Alert>
            <AlertTitle>No public USDC to shield</AlertTitle>
            <AlertDescription>
              Fund this Ready address from Ethereum first, then shield.
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
          disabled={shielding || publicUsdc === BigInt(0)}
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
          {shielding ? "Shielding" : "Shield USDC"}
        </Button>
      </CardFooter>
    </Card>
  );
}
