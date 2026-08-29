"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CopyIcon, DownloadIcon, PencilIcon } from "lucide-react";

import { ConnectWalletChoices } from "@/components/pay/connect-wallet-choices";
import { DeployReadyButton } from "@/components/pay/deploy-ready-button";
import { OnboardingSteps } from "@/components/pay/onboarding-steps";
import { MOROK_MARK_SVG, QrCode, useQrMatrix } from "@/components/pay/qr-code";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
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
import { sameAddress } from "@/lib/pay/activity";
import {
  nextInvoiceId,
  readInvoices,
  saveInvoice,
  subscribeInvoices,
  type MerchantInvoice,
} from "@/lib/pay/invoices";
import { STARKNET_SEPOLIA_STRK_FAUCET_URL } from "@/lib/pay/testnet";
import { qrFileName, renderQrCardPng } from "@/lib/pay/qr-png";
import { paymentUrl, type PaymentRequest } from "@/lib/pay/request";
import { formatStrk, formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";

import { useAccountPresence } from "./use-account-presence";
import { usePoolRegistration } from "./use-pool-registration";
import { useReceiveAccount } from "./use-receive-account";

const EMPTY: MerchantInvoice[] = [];
const DEFAULT_LABEL = "Support the channel";

function useInvoices(network: ReturnType<typeof useNetwork>["network"]) {
  return useSyncExternalStore(
    subscribeInvoices,
    () => readInvoices(network),
    () => EMPTY,
  );
}

function donationFor(
  invoices: MerchantInvoice[],
  address: string,
): MerchantInvoice | undefined {
  return invoices.find(
    (entry) =>
      sameAddress(entry.to, address) &&
      (entry.kind === "donation" || entry.kind === "drop" || !entry.amount),
  );
}

export function SellPanel() {
  const { network } = useNetwork();
  const { session, balances } = useTreasury();
  const invoices = useInvoices(network);
  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [created, setCreated] = useState<PaymentRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presence = useAccountPresence(session?.address);
  const registration = usePoolRegistration(session?.address);
  const publicStrk = balances?.strkWei ?? BigInt(0);
  const canReceive =
    presence === "deployed" && registration === "registered";
  const checking =
    !!session &&
    !canReceive &&
    (presence === "unknown" || registration === "unknown");

  const receive = useReceiveAccount();
  /*
   * The QR carries the receive account when there is one. Whatever address
   * goes on a QR becomes public the first time somebody pays it, so the
   * creator's main account only ends up there when this wallet cannot derive
   * a separate one.
   */
  const publishTo =
    receive.status === "ready" && receive.address
      ? receive.address
      : session?.address;

  const stored = publishTo ? donationFor(invoices, publishTo) : undefined;

  const usdc = getShieldToken("usdc", network);
  const [receiveBalance, setReceiveBalance] = useState<bigint | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const receiveSession = receive.session;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!receiveSession) {
        if (!cancelled) setReceiveBalance(null);
        return;
      }
      try {
        const [entry] = await receiveSession.balances([usdc.address]);
        if (!cancelled) setReceiveBalance(BigInt(entry?.balance ?? 0));
      } catch {
        // A balance that will not read is shown as unknown, not as zero.
        if (!cancelled) setReceiveBalance(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [receiveSession, usdc.address]);

  /* Everything the receive account does is relayed, so the sweep costs the
     creator nothing and never puts the QR's address beside their own. */
  async function sweepToMainAccount() {
    if (!receiveSession || !session || !receiveBalance) return;
    setSweeping(true);
    setError(null);
    try {
      const result = await receiveSession.sweep({
        token: usdc.address,
        amount: receiveBalance,
        to: session.address,
      });
      toast.success("Sent to your main account", {
        description: result.transaction_hash,
      });
      const [entry] = await receiveSession.balances([usdc.address]);
      setReceiveBalance(BigInt(entry?.balance ?? 0));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not send the donations",
      );
    } finally {
      setSweeping(false);
    }
  }
  const request =
    created?.network === network ? created : stored ?? null;

  const payUrl = useMemo(() => {
    if (!request || typeof window === "undefined") return "";
    return paymentUrl(window.location.origin, request);
  }, [request]);

  /*
   * Renaming reuses this: saveInvoice replaces by invoice id, and the id and
   * createdAt are carried over from the stored donation, so the QR keeps its
   * identity and payment history instead of becoming a second one.
   */
  async function persist(nextLabel: string) {
    if (!session) return;
    setError(null);
    setCreating(true);
    try {
      if (!publishTo) {
        throw new Error("Connect a wallet before creating a QR");
      }
      if (publishTo === session.address && !canReceive) {
        throw new Error("Activate STRK20 on this network before creating a QR");
      }
      const next: PaymentRequest = {
        network,
        to: publishTo,
        amount: "",
        invoice: stored?.invoice || nextInvoiceId("TIP"),
        label: nextLabel,
        kind: "donation",
      };
      saveInvoice({
        ...next,
        createdAt: stored?.createdAt ?? Date.now(),
        status: "unpaid",
      });
      setCreated(next);
      setLabel("");
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create QR");
    } finally {
      setCreating(false);
    }
  }

  function handleCreate() {
    return persist(label.trim() || stored?.label || DEFAULT_LABEL);
  }

  /* Blank means "back to the default" here, rather than the create path's
     "keep whatever is stored" - otherwise a rename could never clear one. */
  function handleRename() {
    return persist(label.trim() || DEFAULT_LABEL);
  }

  const qr = useQrMatrix(payUrl);

  async function downloadPng() {
    if (!payUrl || !request) return;
    setDownloading(true);
    try {
      const label = request.label || DEFAULT_LABEL;
      const blob = await renderQrCardPng({
        matrix: qr.data,
        modules: qr.size,
        label,
        logoSvg: MOROK_MARK_SVG,
        network: request.network === "sepolia" ? "Sepolia" : "Mainnet",
      });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = qrFileName(label);
      anchor.click();
      URL.revokeObjectURL(href);
      toast.success("QR image saved");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Could not build the PNG",
      );
    } finally {
      setDownloading(false);
    }
  }

  async function copyUrl() {
    if (!payUrl) return;
    try {
      await navigator.clipboard.writeText(payUrl);
      toast.success("Donation link copied");
    } catch {
      toast.error("Could not copy link");
    }
  }

  async function copyWalletAddress() {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.address);
      toast.success("Starknet address copied");
    } catch {
      toast.error("Could not copy address");
    }
  }

  const deployStatus = !session
    ? "upcoming"
    : presence === "deployed"
      ? "done"
      : "current";
  const activateStatus =
    presence !== "deployed"
      ? "upcoming"
      : registration === "registered"
        ? "done"
        : "current";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">My donation QR</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          One durable link. Supporters choose the amount. You will see the
          USDC. You will not see who sent it.
        </p>
      </div>

      <OnboardingSteps
        title="Get ready to receive"
        description="Connect Ready X, or an EVM wallet with no Starknet wallet at all. MorokPay verifies deployment and privacy activation before creating a QR."
        doneLabel={`${session?.kind === "evm" ? "EVM wallet" : "Ready X"} · ${network === "sepolia" ? "Sepolia" : "Mainnet"} · private donations on`}
        steps={[
          {
            id: "ready",
            title: "Connect Ready X or EVM wallet",
            body: "The connected wallet must control the signing key and its private viewing key.",
            status: session ? "done" : "current",
            children: session ? null : <ConnectWalletChoices />,
          },
          {
            id: "deploy",
            title: `Deploy the Starknet account on ${network === "sepolia" ? "Sepolia" : "Mainnet"}`,
            body:
              presence === "unknown"
                ? "Checking whether this Ready X account is deployed…"
                : "Funding and deployment are separate. Ready X deploys itself the first time it sends anything - its own Activate-account prompt (free, opens when you enable Protected tokens) or the button below (sends 0.01 STRK to MorokPay) both work.",
            status: deployStatus,
            children:
              deployStatus === "current" &&
              presence === "undeployed" &&
              session ? (
                <>
                  <div className="rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/10">
                    <p className="text-xs text-muted-foreground">
                      Starknet address
                    </p>
                    <p className="mt-1 break-all font-mono text-xs tabular-nums">
                      {session.address}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="min-h-12"
                      onClick={() => {
                        void copyWalletAddress();
                      }}
                    >
                      <CopyIcon data-icon="inline-start" />
                      Copy address
                    </Button>
                    {network === "sepolia" && publicStrk <= BigInt(0) ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="min-h-12"
                        nativeButton={false}
                        render={
                          <a
                            href={STARKNET_SEPOLIA_STRK_FAUCET_URL}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        Get test STRK
                      </Button>
                    ) : null}
                  </div>
                  {publicStrk > BigInt(0) ? (
                    <p className="text-sm text-muted-foreground">
                      Funded with {formatStrk(publicStrk)} STRK. No additional
                      faucet request is needed.
                    </p>
                  ) : null}
                  <DeployReadyButton />
                </>
              ) : null,
          },
          {
            id: "activate",
            title: "Enable STRK20 Private",
            body: registration === "unknown" && presence === "deployed"
              ? "Checking this Ready X on the pool…"
              : "This account has no viewing key in the STRK20 pool yet. Ready X must create and register it once before apps can shield or read private balances. Enabling it shields a default amount too - budget about 6 STRK from your public balance.",
            status: activateStatus,
            children:
              activateStatus === "current" && !checking ? (
                <>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>
                      In Ready X Settings, enable Smart Account. The current
                      Ready X privacy backend requires it for a new account.
                    </li>
                    <li>Open the Protected tokens section in Ready X.</li>
                    <li>Select a token and start Shield.</li>
                    <li>Confirm the one-time Activate privacy prompt.</li>
                  </ol>
                  <p className="text-sm text-muted-foreground">
                    Return here after confirmation. MorokPay checks the pool
                    every few seconds and will unlock your donation QR. USDC
                    is not required to receive donations.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {session ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="min-h-12"
                        onClick={() => {
                          void copyWalletAddress();
                        }}
                      >
                        <CopyIcon data-icon="inline-start" />
                        Copy address
                      </Button>
                    ) : null}
                    {network === "sepolia" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="min-h-12"
                        nativeButton={false}
                        render={
                          <a
                            href={STARKNET_SEPOLIA_STRK_FAUCET_URL}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        Get test STRK
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null,
          },
        ]}
      />

      {/* Gated on canReceive, not just session: shown any earlier, this
          lands before "Deploy" and "Enable STRK20" are even done, reading as
          a paragraph of privacy architecture ahead of the checklist that
          actually gets someone to a QR. Hidden outright while the rail cannot
          derive a receive account - on Ready X the card had nothing in it but
          a sentence saying so, which is a worse answer than not raising the
          subject. */}
      {session && canReceive && receive.status !== "unavailable" ? (
        <Card>
          <CardHeader>
            <CardTitle>Anonymous receiving</CardTitle>
            <CardDescription>
              Your QR publishes a separate account, so sharing it never points
              at the wallet holding everything else. MorokPay pays to create
              and register it - a top-up from your own account is the one thing
              that would link them in public.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {receive.address ? (
              <p className="break-all font-mono text-xs text-muted-foreground">
                {receive.address}
              </p>
            ) : null}
            {receive.note ? (
              <p className="text-sm text-muted-foreground">{receive.note}</p>
            ) : null}
            {receive.error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not set it up</AlertTitle>
                <AlertDescription>{receive.error}</AlertDescription>
              </Alert>
            ) : null}
            {receive.status === "ready" ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm tabular-nums">
                  Donations held here:{" "}
                  {receiveBalance === null ? "…" : formatUsdc(receiveBalance)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={sweeping || !receiveBalance}
                  onClick={() => {
                    void sweepToMainAccount();
                  }}
                >
                  {sweeping ? "Sending…" : "Send to my main account"}
                </Button>
                <FieldDescription>
                  A private transfer, relayed like everything else this account
                  does. Your main account appears in it, this one does not.
                </FieldDescription>
              </div>
            ) : null}
          </CardContent>
          {receive.status !== "ready" ? (
            <CardFooter className="border-t">
              <Button
                type="button"
                size="lg"
                className="min-h-12"
                disabled={receive.busy}
                onClick={() => {
                  void receive.activate();
                }}
              >
                {receive.busy ? "Setting up…" : "Set up anonymous receiving"}
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      ) : null}

      {canReceive && !request ? (
        <Card>
          <CardHeader>
            <CardTitle>Create your QR</CardTitle>
            <CardDescription>
              Amount stays off the link. Incoming USDC shows in Activity as To
              this Starknet account, From hidden.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="donation-label">Label</FieldLabel>
                <Input
                  id="donation-label"
                  value={label}
                  placeholder={DEFAULT_LABEL}
                  onChange={(event) => setLabel(event.target.value)}
                />
                <FieldDescription>
                  Shown on the pay screen. Leave blank to use “{DEFAULT_LABEL}”.
                </FieldDescription>
              </Field>
            </FieldGroup>
            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Could not create QR</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="border-t">
            <Button
              type="button"
              size="lg"
              className="min-h-12"
              disabled={creating}
              aria-busy={creating}
              onClick={() => {
                void handleCreate();
              }}
            >
              Create donation QR
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {canReceive && request && payUrl ? (
        <Card>
          <CardHeader>
            <CardTitle>{request.label || DEFAULT_LABEL}</CardTitle>
            <CardDescription>
              Open amount · supporters pick how much
              {request.network === "sepolia" ? " · Sepolia" : ""}
            </CardDescription>
            <CardAction>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={creating}
                onClick={() => {
                  setLabel(editing ? "" : request.label || DEFAULT_LABEL);
                  setEditing(!editing);
                  setError(null);
                }}
              >
                <PencilIcon data-icon="inline-start" />
                {editing ? "Cancel" : "Rename"}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            {editing ? (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="rename-label">Label</FieldLabel>
                  <Input
                    id="rename-label"
                    value={label}
                    placeholder={DEFAULT_LABEL}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                  <FieldDescription>
                    The label travels inside the link, so renaming produces a
                    new link and QR. Ones you already shared keep the old label
                    and still pay this account.
                  </FieldDescription>
                </Field>
                <Button
                  type="button"
                  className="self-start"
                  disabled={creating}
                  aria-busy={creating}
                  onClick={() => {
                    void handleRename();
                  }}
                >
                  Save label
                </Button>
              </FieldGroup>
            ) : null}
            {error && editing ? (
              <Alert variant="destructive">
                <AlertTitle>Could not rename</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <QrCode
              value={payUrl}
              label={`Private donation to ${request.label || DEFAULT_LABEL}`}
            />
            <div className="flex w-full items-start gap-2 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/10">
              <p className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground">
                {payUrl}
              </p>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Copy donation link"
                title="Copy link"
                className="shrink-0"
                onClick={() => {
                  void copyUrl();
                }}
              >
                <CopyIcon />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Post this link anywhere. Amount never appears on the QR.
            </p>
          </CardContent>
          <CardFooter className="flex-wrap gap-2 border-t">
            <Button
              type="button"
              size="lg"
              className="min-h-12"
              onClick={() => {
                void copyUrl();
              }}
            >
              <CopyIcon data-icon="inline-start" />
              Copy link
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-12"
              disabled={downloading}
              aria-busy={downloading}
              onClick={() => {
                void downloadPng();
              }}
            >
              <DownloadIcon data-icon="inline-start" />
              {downloading ? "Preparing" : "Download PNG"}
            </Button>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}
