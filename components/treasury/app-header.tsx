"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletIcon } from "lucide-react";

import { MorokMark } from "@/components/brand/morok-mark";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { shortenAddress } from "@/lib/format";
import type { AppNetwork } from "@/lib/network";

const NAV = [
  { href: "/pay", label: "Pay" },
  { href: "/sell", label: "Sell" },
  { href: "/claim", label: "Claim" },
  { href: "/treasury", label: "Top up" },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  const { session, wallets, connecting, connectWallet, disconnect } =
    useTreasury();
  const { network, setNetwork } = useNetwork();
  const wallet = wallets[0];

  return (
    <header className="border-b border-border/80 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto grid min-h-16 max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-3 sm:flex sm:gap-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:flex-1">
          <Link
            href="/"
            aria-label="MorokPay home"
            className="flex min-w-0 items-center gap-2"
          >
            <MorokMark className="size-8" />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium tracking-tight">MorokPay</span>
              <span className="text-xs text-muted-foreground">
                {network === "sepolia"
                  ? "Private USDC · testnet"
                  : "Private USDC"}
              </span>
            </span>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  pathname === item.href && "bg-accent text-accent-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <ToggleGroup
          aria-label="Network"
          spacing={0}
          size="sm"
          variant="outline"
          value={[network]}
          className="col-span-2 row-start-2 justify-self-end sm:col-auto sm:row-auto"
          onValueChange={(next) => {
            const value = next[0];
            if (value === "mainnet" || value === "sepolia") {
              setNetwork(value as AppNetwork);
            }
          }}
        >
          <ToggleGroupItem value="mainnet">Mainnet</ToggleGroupItem>
          <ToggleGroupItem value="sepolia">Sepolia</ToggleGroupItem>
        </ToggleGroup>
        {session ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-10 max-w-44 truncate"
            onClick={disconnect}
          >
            {shortenAddress(session.address)}
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            className="min-h-10 px-3 text-sm sm:px-5 sm:text-base"
            disabled={!wallet || connecting}
            aria-busy={connecting}
            onClick={() => {
              if (wallet) void connectWallet(wallet);
            }}
          >
            {connecting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <WalletIcon data-icon="inline-start" />
            )}
            {connecting ? "Connecting" : "Connect Ready"}
          </Button>
        )}
      </div>
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-6xl gap-1 px-4 pb-3 sm:hidden md:px-6"
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              pathname === item.href && "bg-accent text-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
