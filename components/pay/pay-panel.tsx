"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { ConnectWalletChoices } from "@/components/pay/connect-wallet-choices";
import { OnboardingSteps } from "@/components/pay/onboarding-steps";
import { ShieldButton } from "@/components/pay/shield-button";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseUsdc } from "@/lib/amount";
import {
  findPendingActivity,
  readActivity,
  recordActivity,
  sameAddress,
  subscribeActivity,
  updateActivity,
  type ActivityItem,
} from "@/lib/pay/activity";
import { CIRCLE_FAUCET_URL } from "@/lib/pay/testnet";
import { parsePaymentLink, parsePaymentRequest } from "@/lib/pay/request";
import { PublicLinkError, transferPrivate } from "@/lib/starknet/actions";
import { extractTxHash, formatStrk20Error } from "@/lib/starknet/errors";
import {
  bounded,
  pollTransactionReceipt,
  WALLET_SUBMISSION_TIMEOUT_MS,
} from "@/lib/starknet/transaction-confirmation";
import { formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";
import { shortenAddress } from "@/lib/format";

import { useAccountPresence } from "./use-account-presence";
import { usePoolRegistration } from "./use-pool-registration";
import { useUsdcMaturity } from "./use-usdc-maturity";

const PRESETS = ["2", "5", "10", "25"];
const EMPTY_ACTIVITY: ActivityItem[] = [];

function isOpenAmount(kind?: string, amount?: string) {
  return (
    !amount && (kind === "donation" || kind === "drop" || kind === undefined)
  );
}

export function PayPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { network, setNetwork, starknet } = useNetwork();
  const {
    session,
    privateRaw,
    balancesLoading,
    balances,
    refreshBalances,
    signatureProgress,
  } = useTreasury();
  const usdc = getShieldToken("usdc", network);
  const fromQuery = useMemo(
    () => parsePaymentRequest(searchParams, network),
    [searchParams, network],
  );
  const [pasted, setPasted] = useState("");
  const [fromPaste, setFromPaste] = useState(
    () => parsePaymentLink(pasted, network),
  );
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);
  // Pending rows this page instance still has an open wallet promise for.
  // A reload empties it, which is exactly how a stranded row is recognised.
  const awaitingSubmission = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  /* Held apart from `error`: this one is a decision for the donor, not a
     failure, and it is the only place the app admits the link can go public. */
  const [publicLink, setPublicLink] = useState<string | null>(null);
  const [donationAmount, setDonationAmount] = useState("");

  const request = fromQuery ?? fromPaste;
  const openAmount = request
    ? isOpenAmount(request.kind, request.amount)
    : false;
  const amountText = request?.amount || donationAmount;
  const activity = useSyncExternalStore(
    subscribeActivity,
    () =>
      session ? readActivity(network, session.address) : EMPTY_ACTIVITY,
    () => EMPTY_ACTIVITY,
  );
  const requestedAmountRaw = useMemo(() => {
    try {
      return parseUsdc(amountText);
    } catch {
      return undefined;
    }
  }, [amountText]);
  const pendingDonation = activity.find(
    (item) =>
      item.kind === "pay" &&
      item.status === "pending" &&
      !!request?.to &&
      !!item.to &&
      sameAddress(item.to, request.to) &&
      (requestedAmountRaw === undefined ||
        item.amountRaw === requestedAmountRaw.toString()),
  );
  const pendingDonationId = pendingDonation?.id ?? null;
  const recipientPresence = useAccountPresence(request?.to);
  const recipientRegistration = usePoolRegistration(request?.to);
  const notes = useUsdcMaturity(session?.address, privateRaw);
  const publicUsdc = balances?.usdcRaw ?? BigInt(0);
  const creatorReady =
    !!request &&
    recipientPresence === "deployed" &&
    recipientRegistration === "registered";
  const canDonate =
    !!session &&
    !!request &&
    creatorReady &&
    notes.ready &&
    privateRaw > BigInt(0);
  const walletName = session?.kind === "evm" ? "EVM wallet" : "Ready";

  /*
   * A donation link arrives in the URL, and once it does the "open a link"
   * step collapses to done and takes its input with it - which left the page
   * with no way back to a different creator short of editing the address bar.
   * The request can come from either the query or the pasted field, so both
   * have to be cleared for the step to reopen.
   */
  function chooseAnotherCreator() {
    router.replace("/pay");
    setPasted("");
    setFromPaste(parsePaymentLink("", network));
    setDonationAmount("");
    setError(null);
    setPublicLink(null);
  }

  useEffect(() => {
    if (fromQuery && fromQuery.network !== network) {
      setNetwork(fromQuery.network);
    }
  }, [fromQuery, network, setNetwork]);

  async function receiptStatus(txHash: string, timeoutMs = 90_000) {
    if (!session) return "pending" as const;
    return pollTransactionReceipt({
      read: () => session.account.provider.getTransactionReceipt(txHash),
      timeoutMs,
    });
  }

  /*
   * extractTxHash scans error text for a felt, and a token address is the
   * same shape as a transaction hash - a pool error naming the token can
   * therefore be mistaken for a submission. Ask the node whether the hash is
   * a transaction at all before a pending row is built around it.
   */
  async function transactionKnown(txHash: string) {
    if (!session) return false;
    try {
      await session.account.provider.getTransaction(txHash);
      return true;
    } catch {
      return false;
    }
  }

  async function refreshPrivateSafely() {
    try {
      await refreshBalances({ private: true });
    } catch {
      // Confirmation state must not be downgraded by a later balance-read error.
    }
  }

  async function checkPendingDonation() {
    if (!session || !pendingDonationId) return;
    const pending = readActivity(network, session.address).find(
      (item) => item.id === pendingDonationId && item.status === "pending",
    );
    if (!pending) {
      return;
    }

    if (pending.txHash) {
      const status = await receiptStatus(pending.txHash, 20_000);
      if (status === "confirmed") {
        updateActivity(pending.id, {
          status: "confirmed",
          confirmation: "receipt",
        });
        toast.success("Donation confirmed", { description: pending.txHash });
        await refreshPrivateSafely();
        return;
      }
      if (status === "failed") {
        updateActivity(pending.id, { status: "failed" });
        setError("The pending donation failed on-chain. You can try again.");
        return;
      }
    }

    await refreshPrivateSafely();
    const stillPending = findPendingActivity({
      network,
      address: session.address,
      kind: "pay",
      to: pending.to,
    });
    if (!stillPending) {
      toast.success("Donation confirmed from the private balance change");
      return;
    }
    /*
     * Still pending after the refresh means the private balance never dropped
     * by this amount. If the row also has no transaction the node recognises,
     * nothing was ever submitted - either the wallet returned no hash, or the
     * recorded one was a felt scraped out of an error message rather than a
     * real submission. With no open wallet promise on this page either (a
     * reload empties that set), the row is provably dead. Releasing it is what
     * lets the donation be retried; leaving it stranded blocked every later
     * donation to the same creator.
     */
    const submitted = pending.txHash
      ? await transactionKnown(pending.txHash)
      : false;
    if (!submitted && !awaitingSubmission.current.has(pending.id)) {
      updateActivity(pending.id, { status: "failed" });
      setError(
        `${walletName} never submitted this donation, and the private balance is unchanged. Nothing was sent - you can donate again.`,
      );
      return;
    }
    setError(
      `The wallet submission is still pending. MorokPay will not send it again; check again after ${walletName} finishes syncing.`,
    );
  }

  async function handlePay(allowPublicLink = false) {
    if (!session || !request) return;
    setPublicLink(null);
    if (payingRef.current) return;
    if (pendingDonationId) {
      payingRef.current = true;
      setPaying(true);
      setError(null);
      try {
        await checkPendingDonation();
      } finally {
        payingRef.current = false;
        setPaying(false);
      }
      return;
    }
    setError(null);
    let amount: bigint;
    try {
      amount = parseUsdc(amountText);
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
      return;
    }
    if (privateRaw < amount) {
      setError(
        formatStrk20Error(new Error("INSUFFICIENT_PRIVATE_BALANCE"), "pay"),
      );
      return;
    }
    const existing = findPendingActivity({
      network,
      address: session.address,
      kind: "pay",
      to: request.to,
      amountRaw: amount,
    });
    if (existing) {
      setError("This donation is already pending. Check it instead of sending it twice.");
      return;
    }
    payingRef.current = true;
    setPaying(true);
    const pending = recordActivity({
      network,
      kind: "pay",
      source: "morok",
      status: "pending",
      amount: amountText,
      amountRaw: amount.toString(),
      invoice: request.invoice || undefined,
      label: request.label || undefined,
      from: session.address,
      to: request.to,
      counterparty: request.to,
      address: session.address,
      balanceBeforeRaw: privateRaw.toString(),
    });
    awaitingSubmission.current.add(pending.id);
    const confirm = async (
      txHash: string | undefined,
      confirmation: "receipt" | "balance" | "wallet",
    ) => {
      updateActivity(pending.id, { txHash, status: "confirmed", confirmation });
      toast.success("Donated privately", {
        description: txHash,
        action: txHash
          ? {
              label: "Voyager",
              onClick: () =>
                window.open(
                  `${starknet.explorer}/tx/${txHash}`,
                  "_blank",
                  "noopener,noreferrer",
                ),
            }
          : undefined,
      });
      await refreshPrivateSafely();
    };

    const giveUp = (caught: unknown) => {
      const current = readActivity(network, session.address).find(
        (item) => item.id === pending.id,
      );
      if (current?.status === "confirmed") return;
      updateActivity(pending.id, { status: "failed" });
      /* Nothing was sent, so this is a question rather than a failure. Saying
         it in the error slot would read as "it broke", and the donor would
         retry blind into the very disclosure being warned about. */
      if (caught instanceof PublicLinkError) {
        setPublicLink(caught.message);
        return;
      }
      setError(formatStrk20Error(caught, "pay"));
    };

    const settleResponse = async (response: unknown) => {
      const txHash = extractTxHash(response);
      if (!txHash) {
        setError(
          `${walletName} returned without a transaction hash. MorokPay will check the private balance and will not submit again.`,
        );
        await refreshPrivateSafely();
        return;
      }
      updateActivity(pending.id, { txHash });
      const status = await receiptStatus(txHash);
      if (status === "confirmed") {
        await confirm(txHash, "receipt");
      } else if (status === "failed") {
        giveUp(new Error("The donation transaction failed on-chain"));
      } else {
        setError(
          "The transaction hash is not confirmed by RPC yet. It remains pending and cannot be submitted twice.",
        );
        await refreshPrivateSafely();
      }
    };

    try {
      const submission = transferPrivate(
        session.account,
        usdc,
        amount,
        request.to,
        { network, allowPublicLink },
      );
      const result = await bounded(submission, WALLET_SUBMISSION_TIMEOUT_MS);
      if (result.status === "settled") {
        awaitingSubmission.current.delete(pending.id);
        await settleResponse(result.value);
      } else {
        setError(
          `${walletName} has not returned yet. The donation stays pending; use Check pending donation instead of sending it again.`,
        );
        // Still genuinely open: keep the id marked so a check does not
        // release a row this promise may yet resolve.
        void submission
          .then(settleResponse)
          .catch((caught) => {
            const txHash = extractTxHash(caught);
            if (txHash) {
              void settleResponse({ transaction_hash: txHash });
            } else {
              giveUp(caught);
            }
          })
          .finally(() => awaitingSubmission.current.delete(pending.id));
      }
    } catch (caught) {
      awaitingSubmission.current.delete(pending.id);
      const scanned = extractTxHash(caught);
      const txHash =
        scanned && (await transactionKnown(scanned)) ? scanned : undefined;
      if (txHash) {
        updateActivity(pending.id, { txHash });
        const status = await receiptStatus(txHash);
        if (status === "confirmed") await confirm(txHash, "receipt");
        // A receipt that never turns final leaves the row pending on purpose,
        // so "Check pending donation" can settle it rather than double-sending.
        else if (status === "failed") giveUp(caught);
        else {
          setError(
            `${walletName} submitted this donation but it has not confirmed yet. Use Check pending donation instead of sending it again.`,
          );
        }
      } else {
        giveUp(caught);
      }
    } finally {
      payingRef.current = false;
      setPaying(false);
    }
  }

  const linkStatus = request ? "done" : "current";
  const readyStatus = request
    ? session
      ? "done"
      : "current"
    : "upcoming";
  const shieldStatus = !request || !session
    ? "upcoming"
    : privateRaw > BigInt(0)
      ? "done"
      : "current";
  const waitStatus =
    !request || !session || privateRaw <= BigInt(0)
      ? "upcoming"
      : notes.ready
        ? "done"
        : "current";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Donate</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {network === "sepolia"
            ? "Sepolia: shield test USDC, wait for the note to mature, then pay. The QR never shows the amount."
            : "Shield USDC, wait a couple of minutes, then pay. The shared QR never shows how much you chose."}
        </p>
      </div>

      <OnboardingSteps
        title="Get ready to donate"
        description="Use Ready or an onboarded EVM wallet. New notes take about ten blocks before they can move."
        doneLabel={`${walletName} · ${formatUsdc(privateRaw)} private USDC · notes mature`}
        steps={[
          {
            id: "link",
            title: request?.label
              ? `Open “${request.label}”`
              : "Open a donation link",
            body: "Scan the creator QR or paste the link they sent you.",
            status: linkStatus,
            children:
              linkStatus === "current" ? (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="pay-link">Donation link</FieldLabel>
                    <Input
                      id="pay-link"
                      value={pasted}
                      inputMode="url"
                      placeholder="/pay?to=0x…&kind=donation"
                      onChange={(event) => {
                        const value = event.target.value;
                        setPasted(value);
                        setFromPaste(parsePaymentLink(value, network));
                        setError(null);
                      }}
                    />
                  </Field>
                  {starknet.treasury ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setPasted("");
                        setFromPaste({
                          network,
                          to: starknet.treasury,
                          amount: "",
                          invoice: "",
                          label: "MorokPay",
                          kind: "donation",
                        });
                        setError(null);
                      }}
                    >
                      No link? Try a donation to MorokPay
                    </Button>
                  ) : null}
                </FieldGroup>
              ) : null,
          },
          {
            id: "ready",
            title: "Connect Ready or EVM wallet",
            body: "Use a supported private wallet on the same network as the header.",
            status: readyStatus,
            children: readyStatus === "current" ? <ConnectWalletChoices /> : null,
          },
          {
            id: "shield",
            title: "Shield USDC",
            body:
              publicUsdc <= BigInt(0)
                ? `You need public USDC on this ${walletName}, then shield it into the pool.`
                : "Move USDC into the private wallet. The pool fee comes out of this amount.",
            status: shieldStatus,
            children:
              shieldStatus === "current" ? (
                <>
                  {publicUsdc <= BigInt(0) ? (
                    <div className="flex flex-wrap gap-2">
                      {network === "sepolia" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className="min-h-12"
                          nativeButton={false}
                          render={
                            <a
                              href={CIRCLE_FAUCET_URL}
                              target="_blank"
                              rel="noreferrer"
                            />
                          }
                        >
                          Get test USDC
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className="min-h-12"
                          nativeButton={false}
                          render={<a href="/treasury" />}
                        >
                          Top up from Base
                        </Button>
                      )}
                    </div>
                  ) : null}
                  <ShieldButton token="usdc" />
                </>
              ) : null,
          },
          {
            id: "wait",
            title: "Wait for the note",
            body: notes.ready
              ? "This USDC can move."
              : `New notes mature in about ten blocks. Donate when this hits 0:00 — the pool rejects a spend before that.`,
            status: waitStatus,
            children:
              waitStatus === "current" ? (
                <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
                  {notes.remainingLabel}
                </p>
              ) : null,
          },
        ]}
      />

      {/* Kept visible even while the note matures or the recipient is still
          being checked: hiding it left the page with a countdown and no sign
          of who the donation is even for. The button below stays disabled
          until canDonate, and the alerts explain what is missing. */}
      {request && session ? (
        <Card>
          <CardHeader>
            <CardTitle>{request.label || "Private donation"}</CardTitle>
            <CardDescription>
              To {shortenAddress(request.to)} on Starknet {request.network}
            </CardDescription>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={paying}
              className="mt-1 self-start px-0 text-muted-foreground hover:text-foreground"
              onClick={chooseAnotherCreator}
            >
              Donate to someone else
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {openAmount ? (
              <Field>
                <FieldLabel htmlFor="payment-amount">Amount (USDC)</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="lg"
                      variant={donationAmount === preset ? "default" : "outline"}
                      className="min-h-10 min-w-16"
                      onClick={() => {
                        setDonationAmount(preset);
                        setError(null);
                      }}
                    >
                      {preset}
                    </Button>
                  ))}
                </div>
                <Input
                  id="payment-amount"
                  className="mt-2"
                  inputMode="decimal"
                  placeholder="Or enter an amount"
                  value={donationAmount}
                  onChange={(event) => {
                    setDonationAmount(event.target.value);
                    setError(null);
                  }}
                />
                <FieldDescription>
                  This amount stays off the shared QR. Activity records your
                  {" "}{walletName} as From and the creator as To.
                </FieldDescription>
              </Field>
            ) : (
              <p className="font-mono text-sm tabular-nums">
                {request.amount} USDC
              </p>
            )}
            {session ? (
              <p className="text-sm tabular-nums">
                Your private USDC:{" "}
                {balancesLoading && privateRaw === BigInt(0)
                  ? "…"
                  : formatUsdc(privateRaw)}
              </p>
            ) : null}
            {privateRaw > BigInt(0) && !notes.ready ? (
              <Alert>
                <AlertTitle>Waiting for the note to mature</AlertTitle>
                <AlertDescription>
                  Ready in {notes.remainingLabel}. New notes need about ten
                  blocks before the pool will let them move.
                </AlertDescription>
              </Alert>
            ) : null}
            {session && request && sameAddress(request.to, session.address) ? (
              <Alert>
                <AlertTitle>This is your own QR</AlertTitle>
                <AlertDescription>
                  Paying it only costs the pool fee. Use a second wallet to see
                  a real donation land.
                </AlertDescription>
              </Alert>
            ) : null}
            {request && recipientPresence === "undeployed" ? (
              <Alert>
                <AlertTitle>
                  Creator is not on Starknet {request.network} yet
                </AlertTitle>
                <AlertDescription>
                  Ask them to open My QR and activate with STRK, then try again.
                </AlertDescription>
              </Alert>
            ) : null}
            {request &&
            recipientPresence !== "undeployed" &&
            recipientRegistration === "unregistered" ? (
              <Alert>
                <AlertTitle>Creator has not activated STRK20</AlertTitle>
                <AlertDescription>
                  Ask them to shield STRK once on My QR before you donate.
                </AlertDescription>
              </Alert>
            ) : null}
            {publicLink ? (
              <Alert>
                <AlertTitle>This donation would be public</AlertTitle>
                <AlertDescription>
                  <p>{publicLink}</p>
                  <p>
                    The amount stays hidden either way, and any later donation
                    to this creator is private whatever you choose now.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 self-start"
                    onClick={() => {
                      void handlePay(true);
                    }}
                  >
                    Donate anyway
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not donate</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="border-t">
            {session ? (
              <div className="flex flex-col">
              <Button
                type="button"
                size="lg"
                className="min-h-12"
                disabled={
                  paying ||
                  (!pendingDonationId &&
                    (!canDonate || !amountText.trim()))
                }
                aria-busy={paying}
                onClick={() => {
                  void handlePay();
                }}
              >
                {paying ? <Spinner data-icon="inline-start" /> : null}
                {paying
                  ? pendingDonationId
                    ? "Checking"
                    : signatureProgress
                      ? `Signature ${signatureProgress.step} of ${signatureProgress.total}`
                      : "Donating"
                  : pendingDonationId
                    ? "Check pending donation"
                    : `Donate ${amountText || "…"} USDC`}
              </Button>
              {/* One STRK20 action needs several prompts; naming the current
                  one keeps a burst of wallet popups from looking like a
                  malfunction. */}
              {paying && signatureProgress ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {signatureProgress.label}
                </p>
              ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Finish the steps above, then confirm in your wallet.
              </p>
            )}
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}
