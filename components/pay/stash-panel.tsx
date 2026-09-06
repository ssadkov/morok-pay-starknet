"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Hex } from "viem";

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
import {
  DEFAULT_ESCROW_V2_EXPIRY_SECONDS,
  downloadEscrowV2Backup,
  ESCROW_V2_BACKUP_CHANGE,
  importEscrowV2Backup,
  listEscrowV2Backups,
  saveEscrowV2Backup,
  updateEscrowV2Backup,
  type EscrowV2Backup,
} from "@/lib/pay/escrow-v2-backup";
import { claimV2Url } from "@/lib/pay/escrow-v2";
import { createEscrowV2Keys, refundEscrowV2Privately } from "@/lib/privacy/escrow-refund-client";
import { PublicLinkError, depositToEscrowV2 } from "@/lib/starknet/actions";
import { extractTxHash, formatStrk20Error } from "@/lib/starknet/errors";
import { escrowV2Status, readEscrowV2Entry, readEscrowV2Minimum } from "@/lib/starknet/escrow-v2";
import { createProvider, formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

type Draft = {
  claimSeed: Hex;
  refundSeed: Hex;
  commitment: string;
  owner: string;
  refundOwner: string;
  expiresAt: number;
  backup: EscrowV2Backup;
};

/**
 * One screen: amount → save recovery → park → share claim link.
 * Recovery stays on this page; the claim link never carries the refund seed.
 */
export function StashPanel() {
  const { network, starknet } = useNetwork();
  const { session, balances, refreshBalances, signatureProgress } = useTreasury();
  const [amount, setAmount] = useState("1");
  const [neverExpires, setNeverExpires] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedRecovery, setSavedRecovery] = useState(false);
  const [busy, setBusy] = useState<"prepare" | "park" | "refund" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [backups, setBackups] = useState<EscrowV2Backup[]>([]);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [importText, setImportText] = useState("");

  const privateUsdc = balances?.privateUsdc ?? BigInt(0);
  const v2Ready = Boolean(starknet.escrowV2 && starknet.escrowV2SupportsPrivateRefund);

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

  async function handlePrepare() {
    if (!session || !v2Ready) return;
    setError(null);
    setBusy("prepare");
    try {
      const parsed = parseUsdc(amount.trim());
      if (parsed <= BigInt(0)) throw new Error("Enter an amount to park");
      if (parsed > privateUsdc) {
        throw new Error(
          `This account holds ${formatUsdc(privateUsdc)} private USDC, less than the ${formatUsdc(parsed)} you are parking.`,
        );
      }
      const usdc = getShieldToken("usdc", network);
      const minimum = await readEscrowV2Minimum({ network, token: usdc.address });
      if (parsed < minimum) {
        throw new Error(`Park at least ${formatUsdc(minimum)} USDC`);
      }

      const keys = await createEscrowV2Keys(network);
      const expiresAt = neverExpires
        ? 0
        : Math.floor(Date.now() / 1000) + DEFAULT_ESCROW_V2_EXPIRY_SECONDS;
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
        claimSeed: keys.claimSeed,
        refundSeed: keys.refundSeed,
        commitment: keys.commitment,
        owner: keys.owner,
        refundOwner: keys.refundOwner,
        expiresAt,
        backup,
      });
      setSavedRecovery(false);
      setLink(null);
      toast.success("Recovery file downloaded. Keep it before parking.");
    } catch (caught) {
      setError(formatStrk20Error(caught, "pay"));
    } finally {
      setBusy(null);
    }
  }

  async function handlePark() {
    if (!session || !draft || !v2Ready || !savedRecovery) return;
    setError(null);
    setBusy("park");
    try {
      const parsed = BigInt(draft.backup.amountRaw);
      const usdc = getShieldToken("usdc", network);
      const response = await depositToEscrowV2(session.account, usdc, parsed, starknet.escrowV2, {
        commitment: draft.commitment,
        owner: draft.owner,
        refundOwner: draft.refundOwner,
        senderAddress: session.address,
        network,
        expiresAt: BigInt(draft.expiresAt),
        indexed: false,
      });
      const txHash = extractTxHash(response);
      const claimLink = claimV2Url(window.location.origin, {
        network,
        seed: draft.claimSeed,
        amount: draft.backup.amount,
      });
      if (txHash) {
        updateEscrowV2Backup(network, draft.commitment, { txHash });
      }
      setLink(claimLink);
      recordActivity({
        network,
        kind: "pay",
        source: "morok",
        status: "confirmed",
        amount: draft.backup.amount,
        amountRaw: draft.backup.amountRaw,
        label: "Parked in escrow V2",
        address: starknet.escrowV2,
        txHash,
      });
      if (txHash) {
        txToast({
          title: "Parked. Share the claim link below.",
          txHash,
          explorerUrl: `${starknet.explorer}/tx/${txHash}`,
          explorerLabel: "Voyager",
        });
      } else {
        toast.success("Parked. Share the claim link below.");
      }
      await refreshBalances({ private: true });
      refreshBackups();
    } catch (caught) {
      if (caught instanceof PublicLinkError) {
        setError(
          "This deposit would publish your address. Open a private self-channel first (send yourself a tiny private amount), then try again.",
        );
      } else {
        setError(formatStrk20Error(caught, "pay"));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleRefund(backup: EscrowV2Backup) {
    if (!session) return;
    setError(null);
    setRefunding(backup.commitment);
    setBusy("refund");
    try {
      const result = await refundEscrowV2Privately({
        account: session.account,
        network: backup.network,
        senderAddress: session.address,
        commitment: backup.commitment,
        refundSeed: backup.refundSeed,
      });
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
      if (caught instanceof PublicLinkError) {
        setError(
          "Refund proof would publish your address. Prepare your private self-channel first.",
        );
      } else {
        setError(formatStrk20Error(caught, "pay"));
      }
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

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Park it behind a link</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Move private USDC into escrow. Whoever opens the link collects with
          MetaMask alone — no Starknet wallet, no STRK. MorokPay pays for their
          claim. You keep a separate recovery file in case nobody claims.
        </p>
      </div>
      <TestnetHint />
      {!session ? <ConnectWalletChoices /> : null}

      {!v2Ready ? (
        <Alert variant="destructive">
          <AlertTitle>No private-refund escrow on this network</AlertTitle>
          <AlertDescription>
            Switch the header to Sepolia. Mainnet V2 is not enabled yet.
          </AlertDescription>
        </Alert>
      ) : link && draft ? (
        <Card>
          <CardHeader>
            <CardTitle>Share this claim link</CardTitle>
            <CardDescription>
              Anyone with the link can collect once. Your recovery file is
              separate — never put it in the same message as this link.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex justify-center">
              <QrCode value={link} label="Claim link" />
            </div>
            <code className="block overflow-x-auto rounded-lg bg-muted p-3 text-xs">
              {link}
            </code>
            <div className="flex flex-wrap gap-2">
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
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Amount</CardTitle>
            <CardDescription>
              {session
                ? `${formatUsdc(privateUsdc)} private USDC available. Minimum 1 USDC.`
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
                disabled={Boolean(draft) || busy !== null}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm leading-snug">
              <input
                type="checkbox"
                className="mt-1"
                checked={neverExpires}
                disabled={Boolean(draft) || busy !== null}
                onChange={(event) => setNeverExpires(event.target.checked)}
              />
              <span>
                Never expires (no refund later). Default is 7 days, then you can
                reclaim privately with your recovery file.
              </span>
            </label>

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
                    disabled={busy !== null || !amount.trim()}
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
                    aria-busy={busy === "park"}
                    onClick={() => {
                      void handlePark();
                    }}
                  >
                    {busy === "park" ? <Spinner data-icon="inline-start" /> : null}
                    {busy === "park"
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
      )}

      {v2Ready ? (
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
        } else if (status.state === "expired") {
          setLabel("Expired — you can reclaim");
          setRefundable(true);
        } else if (props.backup.expiresAt === 0) {
          setLabel("Claimable · never expires");
          setRefundable(false);
        } else {
          const left = Number(status.entry.expiresAt - now);
          const days = Math.max(0, Math.ceil(left / 86_400));
          setLabel(`Claimable · ~${days}d left`);
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
