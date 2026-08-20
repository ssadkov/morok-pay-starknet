"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRightIcon, QrCodeIcon, WalletIcon } from "lucide-react";

import { TestnetHint } from "@/components/pay/testnet-hint";
import { useNetwork } from "@/components/network-provider";

export function HomeDoors() {
  const { network } = useNetwork();

  return (
    <div className="relative isolate flex flex-col gap-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-20 -z-10 h-80 bg-[image:var(--gradient-hero)]"
      />
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Private payments on Starknet
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
          Private USDC payments
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">
          {network === "sepolia"
            ? "Testnet loop: pay or get paid with a QR on Starknet Sepolia. Ready holds the keys. Switch the header to Mainnet when you want sprint evidence."
            : "Pay from a shielded balance, or create a QR for an invoice, a sale, a private donation, or the MorokPay Private Drop. Ready holds the keys."}
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
          body="Create a private-payment QR for checkout, invoices, creator donations, or the Private Drop."
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
      className="group flex min-h-56 flex-col gap-4 rounded-2xl border border-border/80 bg-card p-6 shadow-[0_18px_50px_-36px_color-mix(in_oklch,var(--foreground)_45%,transparent)] transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-1 hover:border-primary/45 hover:shadow-[0_26px_60px_-34px_color-mix(in_oklch,var(--primary)_55%,transparent)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-7"
    >
      <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-primary ring-1 ring-primary/15 [&_svg]:size-5">
        {icon}
      </span>
      <span className="flex items-center justify-between gap-4 text-xl font-semibold tracking-tight">
        {title}
        <ArrowUpRightIcon className="size-5 text-primary transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none" />
      </span>
      <span className="text-sm leading-6 text-muted-foreground">{body}</span>
    </Link>
  );
}
