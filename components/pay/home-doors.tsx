"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRightIcon, HeartIcon, LinkIcon, QrCodeIcon } from "lucide-react";

import { TestnetHint } from "@/components/pay/testnet-hint";
import { useNetwork } from "@/components/network-provider";

export function HomeDoors() {
  const { network } = useNetwork();

  return (
    <div className="relative isolate flex flex-col gap-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-[image:var(--gradient-hero)]"
      />
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Private donations on Starknet
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
          Support a creator privately
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">
          {network === "sepolia"
            ? "Testnet: create a donation QR or open one, then pay with Ready X or an EVM wallet on Starknet Sepolia. Switch the header to Mainnet for the contest."
            : "One QR. The supporter chooses the amount. The transfer stays inside the STRK20 pool, so the shared link never shows how much was sent."}
        </p>
      </div>
      <TestnetHint />
      <div className="grid gap-4 sm:grid-cols-2">
        <Door
          href="/pay"
          icon={<HeartIcon />}
          title="Donate"
          body="Open a donation link or scan a QR. Pick an amount. Confirm in Ready X or an EVM wallet."
        />
        <Door
          href="/sell"
          icon={<QrCodeIcon />}
          title="My QR"
          body="Create one durable donation QR. Share it anywhere. Receive private USDC in your donation wallet."
        />
        <Door
          href="/stash"
          icon={<LinkIcon />}
          title="Send a link"
          body="Park private USDC behind a one-time link. Whoever opens it collects with MetaMask alone - no Starknet wallet, no STRK."
        />
      </div>
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
      className="group flex min-h-56 w-full flex-col gap-4 rounded-2xl border border-border/80 bg-card p-6 text-left shadow-[0_18px_50px_-36px_color-mix(in_oklch,var(--foreground)_45%,transparent)] transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-1 hover:border-primary/45 hover:shadow-[0_26px_60px_-34px_color-mix(in_oklch,var(--primary)_55%,transparent)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-7"
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
