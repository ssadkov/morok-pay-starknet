"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { Hex } from "viem";

import { ConnectWalletChoices } from "@/components/pay/connect-wallet-choices";
import { QrCode } from "@/components/pay/qr-code";
import { txToast } from "@/components/pay/tx-toast";
import { useUsdcMaturity } from "@/components/pay/use-usdc-maturity";
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
import { recordActivity, updateActivity } from "@/lib/pay/activity";
import {
  DEFAULT_ESCROW_V2_EXPIRY_SECONDS,
  ESCROW_V2_EXPIRY_CHOICES,
  downloadEscrowV2Backup,
  ESCROW_V2_BACKUP_CHANGE,
  importEscrowV2Backup,
  listEscrowV2Backups,
  removeEscrowV2Backup,
  saveEscrowV2Backup,
  updateEscrowV2Backup,
  type EscrowV2Backup,
} from "@/lib/pay/escrow-v2-backup";
import { claimV2Url } from "@/lib/pay/escrow-v2";
import {
  createEscrowV2Invoice,
  createEscrowV2Keys,
  refundEscrowV2Privately,
} from "@/lib/privacy/escrow-refund-client";
import {
  ESCROW_SELF_CHANNEL_DUST,
  ensureEscrowSelfChannel,
  hasPrivateSelfChannel,
} from "@/lib/privacy/escrow-self-channel";
import { PublicLinkError, depositToEscrowV2 } from "@/lib/starknet/actions";
import { extractTxHash, formatStrk20Error } from "@/lib/starknet/errors";
import {
  confirmEscrowV2Transaction,
  escrowV2Status,
  readEscrowV2Entry,
  readEscrowV2Minimum,
} from "@/lib/starknet/escrow-v2";
import { createProvider, formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

type Draft = {
  mode: "link" | "invoice";
  claimSeed?: Hex;
  recipientEvm?: string;
  refundSeed: Hex;
  commitment: string;
  owner: string;
  refundOwner: string;
  expiresAt: number;
  indexed: boolean;
  backup: EscrowV2Backup;
};

type Busy = "prepare" | "channel" | "park" | "confirm" | "refund" | null;

/**
 * One screen: amount → save recovery → park → share claim link.
 * Opens a private self-channel automatically when missing so a fresh MetaMask
 * account can park without a manual pre-step.
 */
export function StashPanel() {
  const { network, starknet } = useNetwork();
  const { session, balances, refreshBalances, signatureProgress } = useTreasury();
  const [amount, setAmount] = useState("1");
  const [mode, setMode] = useState<"link" | "invoice">("link");
  const [recipientEvm, setRecipientEvm] = useState("");
  const [expirySeconds, setExpirySeconds] = useState(DEFAULT_ESCROW_V2_EXPIRY_SECONDS);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedRecovery, setSavedRecovery] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [channelReady, setChannelReady] = useState<boolean | null>(null);
  const [channelSubmitted, setChannelSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [backups, setBackups] = useState<EscrowV2Backup[]>([]);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [importText, setImportText] = useState("");

  const privateUsdc = balances?.privateUsdc ?? BigInt(0);
  const v2Ready = Boolean(starknet.escrowV2 && starknet.escrowV2SupportsPrivateRefund);
  const maturity = useUsdcMaturity(session?.address, privateUsdc);
  const needsActivation = session?.kind === "evm" && !session.privacyReady;
  const needsShield = Boolean(session) && !needsActivation && privateUsdc <= BigInt(0);

  function refreshBackups() {
    setBackups(listEscrowV2Backups(network));
  }

  useEffect(() => {
    refreshBackups();
    const onChange = () => refreshBackups();
    window.addEventListener(ESCROW_V2_BACKUP_CHANGE, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(ESCROW_V2_BACKUP_CHANGE, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [network]);

  useEffect(() => {
    if (!session) {
      setChannelReady(null);
      return;
    }
    let cancelled = false;
    void hasPrivateSelfChannel(session.account, session.address)
      .then((ready) => {
        if (!cancelled) setChannelReady(ready);
      })
      .catch(() => {
        if (!cancelled) setChannelReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handlePreparePrivacy() {
    if (!session) return;
    const usdc = getShieldToken("usdc", network);
    setError(null);
    setBusy("channel");
    try {
      const ensured = await ensureEscrowSelfChannel({
        account: session.account,
        token: usdc,
        senderAddress: session.address,
        network,
        force: true,
      });
      if (ensured.txHash) {
        recordActivity({
          network,
          kind: "pay",
          source: "morok",
          status: "pending",
          amount: formatUsdc(ESCROW_SELF_CHANNEL_DUST),
          amountRaw: ESCROW_SELF_CHANNEL_DUST.toString(),
          label: "Prepare escrow privacy",
          address: session.address,
          txHash: ensured.txHash,
        });
        txToast({
          title: "Privacy setup submitted",
          txHash: ensured.txHash,
          explorerUrl: `${starknet.explorer}/tx/${ensured.txHash}`,
          explorerLabel: "Voyager",
        });
      }
      setChannelSubmitted(true);
      setChannelReady(true);
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setBusy(null);
    }
  }

  async function handlePrepare() {
    if (!session || !v2Ready) return;
    setError(null);
    setBusy("prepare");
    try {
      if (needsActivation) {
        throw new Error("Activate privacy on Start first — registration cannot be relayed.");
      }
      if (!maturity.ready) {
        throw new Error(
          `Private USDC is still maturing (${maturity.remainingLabel}). Wait, then try again.`,
        );
      }
      if (channelReady === false) {
        throw new Error(
          "Prepare escrow privacy first, then return later to send. Keeping the two actions apart reduces timing linkage.",
        );
      }
      const parsed = parseUsdc(amount.trim());
      if (parsed <= BigInt(0)) throw new Error("Enter an amount to park");
      if (parsed > privateUsdc) {
        throw new Error(
          `This account holds ${formatUsdc(privateUsdc)} private USDC, less than the ${formatUsdc(parsed)} you are sending.`,
        );
      }
      const usdc = getShieldToken("usdc", network);
      const minimum = await readEscrowV2Minimum({ network, token: usdc.address });
      if (parsed < minimum) {
        throw new Error(`Park at least ${formatUsdc(minimum)} USDC`);
      }

      const blockTime = Number((await createProvider(network).getBlock("latest")).timestamp);
      const expiresAt = expirySeconds === 0 ? 0 : blockTime + expirySeconds;

      if (mode === "invoice") {
        const invoice = await createEscrowV2Invoice(network, recipientEvm.trim());
        const backup: EscrowV2Backup = {
          version: 1,
          network,
          escrow: starknet.escrowV2,
          commitment: invoice.commitment,
          refundSeed: invoice.refundSeed,
          expiresAt,
          amount: formatUsdc(parsed),
          amountRaw: parsed.toString(),
          createdAt: Date.now(),
          recipientEvm: invoice.recipientEvm,
        };
        saveEscrowV2Backup(backup);
        downloadEscrowV2Backup(backup);
        setDraft({
          mode: "invoice",
          recipientEvm: invoice.recipientEvm,
          refundSeed: invoice.refundSeed,
          commitment: invoice.commitment,
          owner: invoice.owner,
          refundOwner: invoice.refundOwner,
          expiresAt,
          indexed: true,
          backup,
        });
      } else {
        const keys = await createEscrowV2Keys(network);
        const backup: EscrowV2Backup = {
          version: 1,
          network,
          escrow: starknet.escrowV2,
          commitment: keys.commitment,
          refundSeed: keys.refundSeed,
          expiresAt,
          amount: formatUsdc(parsed),
          amountRaw: parsed.toString(),
          createdAt: Date.now(),
          claimSeed: keys.claimSeed,
        };
        saveEscrowV2Backup(backup);
        downloadEscrowV2Backup(backup);
        setDraft({
          mode: "link",
          claimSeed: keys.claimSeed,
          refundSeed: keys.refundSeed,
          commitment: keys.commitment,
          owner: keys.owner,
          refundOwner: keys.refundOwner,
          expiresAt,
          indexed: false,
          backup,
        });
      }
      setSavedRecovery(false);
      setLink(null);
      toast.success("Recovery file downloaded. Keep it before parking.");
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setBusy(null);
    }
  }

  async function runParkDeposit() {
    if (!session || !draft || !v2Ready) throw new Error("Not ready to park");
    const parsed = BigInt(draft.backup.amountRaw);
    const usdc = getShieldToken("usdc", network);
    return depositToEscrowV2(session.account, usdc, parsed, starknet.escrowV2, {
      commitment: draft.commitment,
      owner: draft.owner,
      refundOwner: draft.refundOwner,
      senderAddress: session.address,
      network,
      expiresAt: BigInt(draft.expiresAt),
      indexed: draft.indexed,
    });
  }

  async function handlePark() {
    if (!session || !draft || !v2Ready || !savedRecovery) return;
    setError(null);
    try {
      setBusy("park");
      /* No self-channel is opened here on purpose. Opening one moments before
         parking publishes a public setup transaction whose timing lines up
         with the escrow deposit, which is a linkage a watcher gets for free.
         handlePrepare refuses to reach this point without one. */
      let response;
      try {
        response = await runParkDeposit();
      } catch (caught) {
        if (!(caught instanceof PublicLinkError)) throw caught;
        setChannelReady(false);
        throw new Error(
          "This deposit would have named your wallet publicly. Prepare escrow privacy, then come back later to send.",
        );
      }
      const txHash = extractTxHash(response);
      if (txHash) {
        updateEscrowV2Backup(network, draft.commitment, { txHash });
      }
      /* Nothing is shareable until the chain says the entry exists. A link
         handed out on a transaction that later reverts is a link to nothing,
         and the person holding it has no way to tell. */
      if (txHash) {
        setBusy("confirm");
        const settled = await confirmEscrowV2Transaction({
          network,
          transactionHash: txHash,
          commitment: draft.commitment,
          escrow: starknet.escrowV2,
          expected: "open",
        });
        if (settled !== "confirmed") {
          throw new Error(
            settled === "failed" || settled === "mismatch"
              ? "The deposit did not land, so there is nothing to share. Nothing was parked."
              : "The deposit is still pending. Reopen this screen once it confirms - the recovery file already has everything needed.",
          );
        }
      }
      if (draft.mode === "link" && draft.claimSeed) {
        setLink(
          claimV2Url(window.location.origin, {
            network,
            seed: draft.claimSeed,
            amount: draft.backup.amount,
          }),
        );
      } else {
        setLink("invoice");
      }
      recordActivity({
        network,
        kind: "pay",
        source: "morok",
        status: "confirmed",
        amount: draft.backup.amount,
        amountRaw: draft.backup.amountRaw,
        label: draft.mode === "invoice" ? "Parked invoice V2" : "Parked in escrow V2",
        address: starknet.escrowV2,
        txHash,
      });
      if (txHash) {
        txToast({
          title:
            draft.mode === "invoice"
              ? "Parked for that MetaMask."
              : "Parked. Share the claim link below.",
          txHash,
          explorerUrl: `${starknet.explorer}/tx/${txHash}`,
          explorerLabel: "Voyager",
        });
      } else {
        toast.success(
          draft.mode === "invoice"
            ? "Parked for that MetaMask."
            : "Parked. Share the claim link below.",
        );
      }
      await refreshBalances({ private: true });
      refreshBackups();
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setBusy(null);
    }
  }

  async function handleRefund(backup: EscrowV2Backup) {
    if (!session) return;
    setError(null);
    setRefunding(backup.commitment);
    try {
      setBusy("refund");
      let result;
      try {
        /* The entry lives in whichever contract it was parked in, not in
           whichever one is current. Three V2 addresses exist already, so
           reading `escrowV2` here would strand every entry made before the
           last redeploy. */
        result = await refundEscrowV2Privately({
          account: session.account,
          network: backup.network,
          senderAddress: session.address,
          commitment: backup.commitment,
          refundSeed: backup.refundSeed,
          escrow: backup.escrow,
        });
      } catch (caught) {
        if (!(caught instanceof PublicLinkError)) throw caught;
        throw new Error(
          "This refund would have named your wallet publicly. Prepare escrow privacy, then try the refund again.",
        );
      }
      toast.success("Refunded into your private balance");
      if (result.transaction_hash) {
        txToast({
          title: "Private refund submitted",
          txHash: result.transaction_hash,
          explorerUrl: `${starknet.explorer}/tx/${result.transaction_hash}`,
          explorerLabel: "Voyager",
        });
      }
      await refreshBalances({ private: true });
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setRefunding(null);
      setBusy(null);
    }
  }

  function handleImport() {
    try {
      importEscrowV2Backup(importText.trim());
      setImportText("");
      refreshBackups();
      toast.success("Recovery backup imported");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Import failed");
    }
  }

  function resetForm() {
    setLink(null);
    setDraft(null);
    setSavedRecovery(false);
    setAmount("1");
    setError(null);
  }

  const busyParking = busy === "channel" || busy === "park" || busy === "confirm";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        {/* "Park it behind a link" named one of the two things this page does
            and used our own word for it. The page addresses an entry to a
            named EVM wallet just as readily. */}
        <h1 className="text-3xl font-semibold tracking-tight">Send private USDC</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Share a one-time link, or address it to one MetaMask. Either way they
          collect with an EVM wallet alone — no Starknet wallet, no STRK.
          MorokPay pays for their claim.
        </p>
      </div>
      {!session ? <ConnectWalletChoices /> : null}

      {!v2Ready ? (
        <Alert variant="destructive">
          <AlertTitle>No private-refund escrow on this network</AlertTitle>
          <AlertDescription>
            Switch the header to Sepolia. Mainnet V2 is not enabled yet.
          </AlertDescription>
        </Alert>
      ) : null}

      {v2Ready && needsActivation ? (
        <Alert>
          <AlertTitle>Activate privacy first</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              Registration cannot be relayed. Finish Start (deploy → STRK →
              activate), then shield USDC and come back here.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              nativeButton={false}
              render={<Link href="/start" />}
            >
              Go to Start
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* handlePrepare refuses to park while channelReady is false, and until
          now nothing on the page could clear that: the refactor that split
          preparing out of the park never rendered the step it split off, so
          the handler sat unreferenced and the park dead-ended on its own
          error message. Same failure as every other half-wired thing on this
          branch - the capability existed, the call site did not. */}
      {v2Ready && session && !needsActivation && channelReady === false ? (
        <Alert>
          <AlertTitle>Prepare privacy once</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              Sending privately needs a private channel to yourself, opened by
              one public transaction. It is deliberately a separate step: doing
              it moments before a park lines the two up in time for anyone
              watching the chain.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={busyParking}
              aria-busy={busy === "channel"}
              onClick={() => void handlePreparePrivacy()}
            >
              {busy === "channel" ? <Spinner data-icon="inline-start" /> : null}
              {busy === "channel" ? "Preparing" : "Prepare privacy"}
            </Button>
            {channelSubmitted ? (
              <p className="text-xs">
                Submitted. Give it a few blocks, then park.
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {v2Ready && needsShield ? (
        <Alert>
          <AlertTitle>Shield some USDC</AlertTitle>
          <AlertDescription>
            Park spends private USDC. Shield at least 1 USDC from the Balances
            sidebar, wait ~45s for the note to mature, then park here.
          </AlertDescription>
        </Alert>
      ) : null}

      {v2Ready && link && draft ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {draft.mode === "invoice" ? "Parked for MetaMask" : "Share this claim link"}
            </CardTitle>
            <CardDescription>
              {draft.mode === "invoice"
                ? "The recipient opens /claim with that MetaMask. Tokens land as a public Starknet balance. Keep your recovery file separate."
                : "Anyone with the link can collect once. Your recovery file is separate — never put it in the same message as this link."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {draft.mode === "invoice" ? (
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  Recipient MetaMask:{" "}
                  <code className="rounded bg-muted px-1 text-xs">
                    {draft.recipientEvm}
                  </code>
                </p>
                <p className="text-muted-foreground">
                  Tell them to open{" "}
                  <code className="rounded bg-muted px-1 text-xs">/claim</code>{" "}
                  with that wallet — the park shows up in their inbox.
                </p>
              </div>
            ) : (
              <>
                <div className="flex justify-center">
                  <QrCode value={link} label="Claim link" />
                </div>
                <code className="block overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                  {link}
                </code>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {draft.mode === "link" ? (
                <Button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(link)
                      .then(() => toast.success("Link copied"))
                      .catch(() => toast.error("Could not copy — select it by hand"));
                  }}
                >
                  Copy link
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => {
                    const claimPage = `${window.location.origin}/claim`;
                    void navigator.clipboard
                      .writeText(claimPage)
                      .then(() => toast.success("Claim page copied"))
                      .catch(() => toast.error("Could not copy"));
                  }}
                >
                  Copy claim page
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => downloadEscrowV2Backup(draft.backup)}
              >
                Download recovery again
              </Button>
              <Button type="button" variant="outline" onClick={resetForm}>
                Park another
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {v2Ready && session && !(link && draft) ? (
        <Card>
          <CardHeader>
            <CardTitle>Amount</CardTitle>
            <CardDescription>
              {session
                ? `${formatUsdc(privateUsdc)} private USDC available. Minimum 1 USDC.`
                : "Connect a wallet with a private USDC balance."}
              {session && !maturity.ready && privateUsdc > 0n
                ? ` Notes still maturing (${maturity.remainingLabel}).`
                : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "link" ? "default" : "outline"}
                disabled={Boolean(draft) || busy !== null}
                onClick={() => setMode("link")}
              >
                Share a link
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "invoice" ? "default" : "outline"}
                disabled={Boolean(draft) || busy !== null}
                onClick={() => setMode("invoice")}
              >
                Pay a MetaMask
              </Button>
            </div>
            {mode === "invoice" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="stash-recipient">Recipient MetaMask address</Label>
                <Input
                  id="stash-recipient"
                  placeholder="0x…"
                  value={recipientEvm}
                  disabled={Boolean(draft) || busy !== null}
                  onChange={(event) => setRecipientEvm(event.target.value)}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="stash-amount">USDC to park</Label>
              <Input
                id="stash-amount"
                inputMode="decimal"
                placeholder="1.00"
                value={amount}
                disabled={Boolean(draft) || busy !== null}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="stash-refund-after">Refund available after</Label>
              <select
                id="stash-refund-after"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={expirySeconds}
                disabled={Boolean(draft) || busy !== null}
                onChange={(event) => setExpirySeconds(Number(event.target.value))}
              >
                {ESCROW_V2_EXPIRY_CHOICES.map((choice) => (
                  <option key={choice.label} value={choice.seconds}>
                    {choice.label}
                  </option>
                ))}
              </select>
              <span className="text-sm leading-snug text-muted-foreground">
                {/* "Expiry" was the wrong word: nothing stops working. After
                    this the sender may also reclaim, and whoever moves first
                    takes the money. */}
                The link never stops working. After this you may also reclaim
                it privately — whichever of you goes first takes the money.
              </span>
            </div>

            {draft ? (
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <p className="text-sm font-medium">Recovery backup</p>
                <p className="text-xs text-muted-foreground">
                  A file was downloaded. Keep it offline. Losing it means you
                  cannot reclaim after expiry.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => downloadEscrowV2Backup(draft.backup)}
                  >
                    Download again
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(JSON.stringify(draft.backup, null, 2))
                        .then(() => toast.success("Recovery JSON copied"))
                        .catch(() => toast.error("Could not copy"));
                    }}
                  >
                    Copy JSON
                  </Button>
                </div>
                <label className="flex items-start gap-2 text-sm leading-snug">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={savedRecovery}
                    onChange={(event) => setSavedRecovery(event.target.checked)}
                  />
                  <span>I saved the recovery file somewhere I can find later</span>
                </label>
              </div>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not park it</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-3 border-t sm:flex-row sm:items-center">
            {session ? (
              <>
                {!draft ? (
                  <Button
                    type="button"
                    size="lg"
                    className="min-h-10"
                    disabled={
                      busy !== null ||
                      !amount.trim() ||
                      (mode === "invoice" && !recipientEvm.trim()) ||
                      needsActivation ||
                      needsShield ||
                      !maturity.ready
                    }
                    aria-busy={busy === "prepare"}
                    onClick={() => {
                      void handlePrepare();
                    }}
                  >
                    {busy === "prepare" ? <Spinner data-icon="inline-start" /> : null}
                    {busy === "prepare" ? "Preparing" : "Prepare recovery"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="lg"
                    className="min-h-10"
                    disabled={!savedRecovery || busy !== null}
                    aria-busy={busyParking}
                    onClick={() => {
                      void handlePark();
                    }}
                  >
                    {busyParking ? <Spinner data-icon="inline-start" /> : null}
                    {busy === "channel"
                      ? "Opening private channel"
                      : busy === "confirm"
                        ? "Confirming on chain"
                        : busy === "park"
                          ? signatureProgress
                            ? `Signature ${signatureProgress.step} of ${signatureProgress.total}`
                            : "Parking"
                          : "Park and make a link"}
                  </Button>
                )}
                {draft ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => {
                      setDraft(null);
                      setSavedRecovery(false);
                    }}
                  >
                    Start over
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Connect a wallet above to park.</p>
            )}
            {busy === "park" && signatureProgress ? (
              <p className="w-full text-xs text-muted-foreground">{signatureProgress.label}</p>
            ) : null}
          </CardFooter>
        </Card>
      ) : null}

      {/* An empty recovery list in front of a disconnected visitor is a card
          explaining a file they have not got for a park they have not made. */}
      {v2Ready && (session || backups.length > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle>Your recovery list</CardTitle>
            <CardDescription>
              Backups stay on this device. Import a JSON file if you parked from
              another browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {backups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recovery records yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {backups.map((backup) => (
                  <BackupRow
                    key={`${backup.network}-${backup.commitment}`}
                    backup={backup}
                    busy={refunding === backup.commitment}
                    canRefund={Boolean(session)}
                    onDownload={() => downloadEscrowV2Backup(backup)}
                    onRefund={() => {
                      void handleRefund(backup);
                    }}
                  />
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="stash-import">Import recovery JSON</Label>
              <textarea
                id="stash-import"
                className="min-h-24 rounded-lg border bg-background p-3 font-mono text-xs"
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder='{"version":1,"network":"sepolia",...}'
              />
              <Button
                type="button"
                variant="outline"
                disabled={!importText.trim()}
                onClick={handleImport}
              >
                Import
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function BackupRow(props: {
  backup: EscrowV2Backup;
  busy: boolean;
  canRefund: boolean;
  onDownload: () => void;
  onRefund: () => void;
}) {
  const [label, setLabel] = useState("Checking…");
  const [refundable, setRefundable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const entry = await readEscrowV2Entry({
          network: props.backup.network,
          commitment: props.backup.commitment,
        });
        const now = BigInt((await createProvider(props.backup.network).getBlock("latest")).timestamp);
        const status = escrowV2Status(entry, now);
        if (cancelled) return;
        if (status.state === "missing") {
          setLabel("Not funded or unknown");
          setRefundable(false);
        } else if (status.state === "claimed") {
          setLabel("Claimed");
          setRefundable(false);
        } else if (status.state === "refunded") {
          setLabel("Refunded to you");
          setRefundable(false);
        } else if (status.refundable) {
          setLabel("Open · you can reclaim (claim still works)");
          setRefundable(true);
        } else if (props.backup.expiresAt === 0) {
          setLabel("Claimable · never refundable");
          setRefundable(false);
        } else {
          const left = Number(status.entry.expiresAt - now);
          const days = Math.max(0, Math.ceil(left / 86_400));
          setLabel(`Claimable · refund in ~${days}d`);
          setRefundable(false);
        }
      } catch {
        if (!cancelled) {
          setLabel(props.backup.amount + " USDC");
          setRefundable(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [props.backup]);

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{props.backup.amount} USDC</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={props.onDownload}>
          Recovery
        </Button>
        {refundable && props.canRefund ? (
          <Button
            type="button"
            size="sm"
            disabled={props.busy}
            aria-busy={props.busy}
            onClick={props.onRefund}
          >
            {props.busy ? <Spinner data-icon="inline-start" /> : null}
            {props.busy ? "Refunding" : "Refund privately"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
