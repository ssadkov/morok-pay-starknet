"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CopyIcon } from "lucide-react";

import { ConnectWalletChoices } from "@/components/pay/connect-wallet-choices";
import { DeployReadyButton } from "@/components/pay/deploy-ready-button";
import { OnboardingSteps } from "@/components/pay/onboarding-steps";
import { QrCode } from "@/components/pay/qr-code";
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
import { sameAddress } from "@/lib/pay/activity";
import {
  nextInvoiceId,
  readInvoices,
  saveInvoice,
  subscribeInvoices,
  type MerchantInvoice,
} from "@/lib/pay/invoices";
import { STARKNET_SEPOLIA_STRK_FAUCET_URL } from "@/lib/pay/testnet";
import { paymentUrl, type PaymentRequest } from "@/lib/pay/request";
import { formatStrk } from "@/lib/starknet/status";

import { useAccountPresence } from "./use-account-presence";
import { usePoolRegistration } from "./use-pool-registration";

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

  const stored = session
    ? donationFor(invoices, session.address)
    : undefined;
  const request =
    created?.network === network ? created : stored ?? null;

  const payUrl = useMemo(() => {
    if (!request || typeof window === "undefined") return "";
    return paymentUrl(window.location.origin, request);
  }, [request]);

  async function handleCreate() {
    if (!session) return;
    setError(null);
    setCreating(true);
    try {
      if (!canReceive) {
        throw new Error("Activate STRK20 on this network before creating a QR");
      }
      const next: PaymentRequest = {
        network,
        to: session.address,
        amount: "",
        invoice: stored?.invoice || nextInvoiceId("TIP"),
        label: label.trim() || stored?.label || DEFAULT_LABEL,
        kind: "donation",
      };
      saveInvoice({
        ...next,
        createdAt: stored?.createdAt ?? Date.now(),
        status: "unpaid",
      });
      setCreated(next);
      setLabel("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create QR");
    } finally {
      setCreating(false);
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
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">My donation QR</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          One durable link. Supporters choose the amount. You will see the
          USDC. You will not see who sent it.
        </p>
      </div>

      <OnboardingSteps
        title="Get ready to receive"
        description={network === "sepolia" ? "Connect Ready or an onboarded EVM wallet. MorokPay verifies deployment and privacy activation before creating a QR." : "Match the header to Mainnet in Ready. Fund and deploy the account, then confirm Ready's one-time privacy activation."}
        doneLabel={`${session?.kind === "evm" ? "EVM wallet" : "Ready"} · ${network === "sepolia" ? "Sepolia" : "Mainnet"} · private donations on`}
        steps={[
          {
            id: "ready",
            title: network === "sepolia" ? "Connect Ready or EVM wallet" : "Connect Ready",
            body: "The connected wallet must control the signing key and its private viewing key.",
            status: session ? "done" : "current",
            children: session ? null : <ConnectWalletChoices />,
          },
          {
            id: "deploy",
            title: `Deploy the Starknet account on ${network === "sepolia" ? "Sepolia" : "Mainnet"}`,
            body:
              presence === "unknown"
                ? "Checking whether this Ready account is deployed…"
                : "Funding and deployment are separate. In Ready, send one small outgoing transaction to another account on this network. Ready deploys itself with that first transaction.",
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
              ? "Checking this Ready on the pool…"
              : "This account has no viewing key in the STRK20 pool yet. Ready must create and register it once before apps can shield or read private balances.",
            status: activateStatus,
            children:
              activateStatus === "current" && !checking ? (
                <>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>
                      In Ready Settings, enable Smart Account. The current
                      Ready privacy backend requires it for a new account.
                    </li>
                    <li>Open the Protected tokens section in Ready.</li>
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
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <QrCode
              value={payUrl}
              label={`Private donation to ${request.label || DEFAULT_LABEL}`}
            />
            <p className="break-all font-mono text-xs text-muted-foreground">
              {payUrl}
            </p>
            <p className="text-sm text-muted-foreground">
              First 10 contest: post this link. Amount never appears on the QR.
            </p>
          </CardContent>
          <CardFooter className="border-t">
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
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}
