"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SendIcon } from "lucide-react";

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
import { payoutUsdc } from "@/lib/starknet/actions";
import { formatUsdc } from "@/lib/starknet/status";

export function PayoutPanel() {
  const { session, balances, refreshBalances } = useTreasury();
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;
  const ready = session;

  const privateUsdc = balances?.privateUsdc ?? BigInt(0);

  async function handlePayout() {
    setError(null);
    setSending(true);
    try {
      const parsed = amount.trim() ? parseUsdc(amount) : privateUsdc;
      const response = await payoutUsdc(ready.account, parsed, recipient);
      toast.success("Payout submitted", {
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
      setError(caught instanceof Error ? caught.message : "Payout failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout to a fresh address</CardTitle>
        <CardDescription>
          Unshield private USDC to a Starknet address you paste. Use a new
          wallet so the payout is not linked to this Ready account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="payout-recipient">Recipient</FieldLabel>
            <Input
              id="payout-recipient"
              placeholder="0x…"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
            <FieldDescription>
              A public Starknet address. Do not reuse this Ready account.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="payout-amount">Amount</FieldLabel>
            <Input
              id="payout-amount"
              inputMode="decimal"
              placeholder={
                privateUsdc > BigInt(0) ? formatUsdc(privateUsdc) : "0.00"
              }
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <FieldDescription>
              Leave empty to unshield the full private balance (
              {formatUsdc(privateUsdc)} USDC).
            </FieldDescription>
          </Field>
        </FieldGroup>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Payout failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          size="lg"
          className="min-h-10"
          disabled={sending || privateUsdc === BigInt(0) || !recipient.trim()}
          aria-busy={sending}
          onClick={() => {
            void handlePayout();
          }}
        >
          {sending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <SendIcon data-icon="inline-start" />
          )}
          {sending ? "Sending" : "Payout USDC"}
        </Button>
      </CardFooter>
    </Card>
  );
}
