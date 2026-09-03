"use client";

import { useState } from "react";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import { validateAndParseAddress } from "starknet";

import { txToast } from "@/components/pay/tx-toast";
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
import {
  PublicLinkError,
  transferPrivate,
  transferPublicToken,
} from "@/lib/starknet/actions";
import { STRK_ADDRESS } from "@/lib/starknet/constants";
import { describeError } from "@/lib/starknet/errors";
import { formatStrk, formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";
import { parseTokenAmount } from "@/lib/amount";
import { pollTransactionReceipt } from "@/lib/starknet/transaction-confirmation";

import { usePoolRegistration } from "./use-pool-registration";
import { useUsdcMaturity } from "./use-usdc-maturity";

/**
 * Left behind so the account can still pay gas after emptying itself, and
 * measured per rail rather than assumed.
 *
 * A public transfer signed through the Eth712 account costs about 1.33 STRK -
 * validating an EIP-712 signature in Cairo is not free - so a flat one-STRK
 * reserve was less than a single transaction. Max would hand back an amount
 * that emptied the account past its own next fee. Ready X transfers cost
 * about 0.07 on the same measurements, where one STRK is already generous.
 */
const GAS_RESERVE_EVM = BigInt(2) * BigInt(10) ** BigInt(18);
const GAS_RESERVE_READY = BigInt(10) ** BigInt(18);

/**
 * Moves a public balance out of the Starknet account to any other address.
 *
 * The last step of the round trip, and the only one with no privacy in it:
 * unshielding lands USDC in the public account, and from there it has to
 * reach an exchange like any ordinary transfer. Kept behind a dialog rather
 * than inline, because sending everything away is the rarest thing this
 * screen does and the easiest to fire by accident.
 */
export function SendButton({ mode = "public" }: { mode?: "public" | "private" } = {}) {
  const { session, balances, refreshBalances } = useTreasury();
  const { network, starknet } = useNetwork();
  const [open, setOpen] = useState(false);
  const [asset, setAsset] = useState<"usdc" | "strk">("usdc");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const privateUsdc = balances?.privateUsdc ?? BigInt(0);
  const notes = useUsdcMaturity(session?.address, privateUsdc);
  /* The pool cannot credit a note to an account that never registered a
     viewing key, so a private send to one fails at the wallet with an error
     nobody can act on. Say it before they sign anything. */
  const trimmedRecipient = recipient.trim();
  const recipientRegistration = usePoolRegistration(
    mode === "private" && /^0x[0-9a-fA-F]{1,64}$/.test(trimmedRecipient)
      ? trimmedRecipient
      : undefined,
  );

  if (!session) return null;

  const isPrivate = mode === "private";
  const usdc = getShieldToken("usdc", network);
  const publicUsdc = balances?.usdcRaw ?? BigInt(0);
  const publicStrk = balances?.strkWei ?? BigInt(0);
  const gasReserve =
    session?.kind === "evm" ? GAS_RESERVE_EVM : GAS_RESERVE_READY;
  const isStrk = !isPrivate && asset === "strk";
  const decimals = isStrk ? 18 : usdc.decimals;
  const available = isPrivate ? privateUsdc : isStrk ? publicStrk : publicUsdc;
  /* STRK pays this account's own gas, so offering "all of it" would strand
     the account. USDC has no such role and can go out to the last cent. */
  const sendable =
    isStrk && available > gasReserve ? available - gasReserve : isStrk ? BigInt(0) : available;
  const blocked = isPrivate
    ? privateUsdc <= BigInt(0)
      ? "Nothing shielded to send."
      : !notes.ready
        ? `Freshly shielded USDC matures in ${notes.remainingLabel}. The proving block cannot see it before then.`
        : recipientRegistration === "unregistered"
          ? "That address has not enabled Private, so the pool cannot credit it. Ask them to activate STRK20 first."
          : null
    : null;
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
      if (isStrk && available - parsed < gasReserve) {
        throw new Error(
          `Leave at least ${formatStrk(gasReserve)} STRK behind, or this account cannot pay gas again`,
        );
      }
      const response = isPrivate
        ? await transferPrivate(session.account, usdc, parsed, to, { network })
        : await transferPublicToken(
            session.account,
            isStrk ? STRK_ADDRESS : usdc.address,
            to,
            parsed,
          );
      txToast({
        title: `${format(parsed)} ${isPrivate ? "private USDC" : asset.toUpperCase()} sent`,
        txHash: response.transaction_hash,
        explorerUrl: `${starknet.explorer}/tx/${response.transaction_hash}`,
        explorerLabel: "Voyager",
      });
      setOpen(false);
      setAmount("");
      setRecipient("");
      /* Gas is only deducted when the transaction is included, so refreshing
         straight after submitting read the balance as it was before the send.
         The stale figure then fed Max on the next one, which offered more
         than the account held and was refused by the token contract with
         "insufficient balance" - a true statement about a balance the screen
         was not showing. */
      await pollTransactionReceipt({
        read: () =>
          session.account.provider.getTransactionReceipt(
            response.transaction_hash,
          ),
      });
      await refreshBalances({ private: false });
    } catch (error) {
      if (error instanceof PublicLinkError) {
        toast.error("This one would be public", { description: error.message });
        return;
      }
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
            {isPrivate ? "Send privately" : "Send"}
          </Button>
        }
      />
      <DialogContent>
        <div className="flex flex-col gap-1">
          <DialogTitle>
            {isPrivate
              ? "Send private USDC"
              : "Send from your Starknet account"}
          </DialogTitle>
          <DialogDescription>
            {isPrivate
              ? `Stays inside the STRK20 pool: the amount is not published, and the recipient must already have Private enabled on ${network}.`
              : `An ordinary public transfer. Nothing about it is private, and the recipient must be a Starknet address on ${network}.`}
          </DialogDescription>
        </div>

        {isPrivate ? null : (
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
        )}

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
            {isPrivate
              ? "A Starknet address that has enabled Private. The first transfer to one you have never paid opens a channel, and MorokPay relays that one so you are not named in it."
              : "A Starknet address. An exchange deposit address works if that exchange lists Starknet."}
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
            {format(available)} {isPrivate ? "private USDC" : asset.toUpperCase()} available
            {isStrk
              ? ` · ${formatStrk(gasReserve)} STRK stays behind for gas`
              : ""}
          </FieldDescription>
        </Field>

        {blocked ? (
          <p className="text-sm text-muted-foreground">{blocked}</p>
        ) : null}

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
            disabled={
              sending || !recipient.trim() || !amount.trim() || Boolean(blocked)
            }
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
