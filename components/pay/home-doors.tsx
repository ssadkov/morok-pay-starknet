"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { QrCodeIcon, WalletIcon } from "lucide-react";

import { TestnetHint } from "@/components/pay/testnet-hint";
import { useNetwork } from "@/components/network-provider";

export function HomeDoors() {
  const { network } = useNetwork();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Private USDC payments
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {network === "sepolia"
            ? "Testnet loop: pay or get paid with a QR on Starknet Sepolia. Ready holds the keys. Switch the header to Mainnet when you want sprint evidence."
            : "Pay a merchant from your shielded balance, or get paid with a QR invoice. Ready holds the keys. Nobody else sees who paid whom."}
        </p>
      </div>
      <TestnetHint />
      <div className="grid gap-4 sm:grid-cols-2">
        <Door
          href="/pay"
          icon={<WalletIcon />}
          title="Pay privately"
          body="Open a payment link or scan a QR. Confirm in Ready. The transfer stays inside the STRK20 pool."
        />
        <Door
          href="/sell"
          icon={<QrCodeIcon />}
          title="Get paid"
          body="Create an invoice, show a QR, match the account number later. Your Ready address is the till."
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Need to fund the private balance first?{" "}
        <Link href="/treasury" className="underline underline-offset-4">
          {network === "sepolia"
            ? "Top up on Sepolia (faucet, then shield)"
            : "Top up from Base"}
        </Link>
        .
      </p>
    </div>
  );
}

function Door({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-44 flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10 transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="text-lg font-semibold tracking-tight">{title}</span>
      <span className="text-sm text-muted-foreground">{body}</span>
    </Link>
  );
}
