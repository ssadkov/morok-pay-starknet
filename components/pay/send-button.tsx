"use client";

import { useState } from "react";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import { validateAndParseAddress } from "starknet";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { transferPublicToken } from "@/lib/starknet/actions";
import { STRK_ADDRESS } from "@/lib/starknet/constants";
import { describeError } from "@/lib/starknet/errors";
import { formatStrk, formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";
import { parseTokenAmount } from "@/lib/amount";

/** Left behind so the account can still pay gas after emptying itself. */
const GAS_RESERVE = BigInt(10) ** BigInt(18);

/**
 * Moves a public balance out of the Starknet account to any other address.
 *
 * The last step of the round trip, and the only one with no privacy in it:
 * unshielding lands USDC in the public account, and from there it has to
 * reach an exchange like any ordinary transfer. Kept behind a dialog rather
 * than inline, because sending everything away is the rarest thing this
 * screen does and the easiest to fire by accident.
 */
export function SendButton() {
  const { session, balances, refreshBalances } = useTreasury();
  const { network, starknet } = useNetwork();
  const [open, setOpen] = useState(false);
  const [asset, setAsset] = useState<"usdc" | "strk">("usdc");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);

  if (!session) return null;

  const usdc = getShieldToken("usdc", network);
  const publicUsdc = balances?.usdcRaw ?? BigInt(0);
  const publicStrk = balances?.strkWei ?? BigInt(0);
  const isStrk = asset === "strk";
  const decimals = isStrk ? 18 : usdc.decimals;
  const available = isStrk ? publicStrk : publicUsdc;
  /* STRK pays this account's own gas, so offering "all of it" would strand
     the account. USDC has no such role and can go out to the last cent. */
  const sendable =
    isStrk && available > GAS_RESERVE ? available - GAS_RESERVE : isStrk ? BigInt(0) : available;
  const format = isStrk ? formatStrk : formatUsdc;

  async function handleSend() {
    if (!session) return;
    setSending(true);
    try {
      const to = validateAndParseAddress(recipient.trim());
      const parsed = parseTokenAmount(amount, decimals);
      if (parsed <= BigInt(0)) throw new Error("Enter an amount to send");
      if (parsed > available) {
        throw new Error(`Only ${format(available)} ${asset.toUpperCase()} is available`);
      }
      if (isStrk && available - parsed < GAS_RESERVE) {
        throw new Error(
          `Leave at least ${formatStrk(GAS_RESERVE)} STRK behind, or this account cannot pay gas again`,
        );
      }
      const response = await transferPublicToken(
        session.account,
        isStrk ? STRK_ADDRESS : usdc.address,
        to,
        parsed,
      );
      toast.success(`${format(parsed)} ${asset.toUpperCase()} sent`, {
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
      setOpen(false);
      setAmount("");
      setRecipient("");
      await refreshBalances({ private: false });
    } catch (error) {
      toast.error(describeError(error) || "The transfer failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" size="sm" variant="outline">
            <SendIcon data-icon="inline-start" />
            Send
          </Button>
        }
      />
      <DialogContent>
        <div className="flex flex-col gap-1">
          <DialogTitle>Send from your Starknet account</DialogTitle>
          <DialogDescription>
            An ordinary public transfer. Nothing about it is private, and the
            recipient must be a Starknet address on {network}.
          </DialogDescription>
        </div>

        <ToggleGroup
          value={[asset]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "usdc" || next === "strk") {
              setAsset(next);
              setAmount("");
            }
          }}
        >
          <ToggleGroupItem value="usdc">USDC</ToggleGroupItem>
          <ToggleGroupItem value="strk">STRK</ToggleGroupItem>
        </ToggleGroup>

        <Field>
          <FieldLabel htmlFor="send-recipient">Recipient</FieldLabel>
          <Input
            id="send-recipient"
            value={recipient}
            spellCheck={false}
            autoComplete="off"
            placeholder="0x…"
            onChange={(event) => setRecipient(event.target.value)}
          />
          <FieldDescription>
            A Starknet address. An exchange deposit address works if that
            exchange lists Starknet.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="send-amount">Amount</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="send-amount"
              value={amount}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(event) => setAmount(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={sendable <= BigInt(0)}
              onClick={() => setAmount(format(sendable))}
            >
              Max
            </Button>
          </div>
          <FieldDescription>
            {format(available)} {asset.toUpperCase()} available
            {isStrk
              ? ` · ${formatStrk(GAS_RESERVE)} STRK stays behind for gas`
              : ""}
          </FieldDescription>
        </Field>

        <div className="flex justify-end gap-2">
          <DialogClose
            render={
              <Button type="button" variant="ghost" disabled={sending}>
                Cancel
              </Button>
            }
          />
          <Button
            type="button"
            disabled={sending || !recipient.trim() || !amount.trim()}
            aria-busy={sending}
            onClick={() => {
              void handleSend();
            }}
          >
            {sending ? <Spinner data-icon="inline-start" /> : null}
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
