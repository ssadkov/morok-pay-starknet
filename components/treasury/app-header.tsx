"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletIcon } from "lucide-react";

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
  { href: "/sell", label: "Get paid" },
  { href: "/treasury", label: "Top up" },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  const { session, wallets, connecting, connectWallet, disconnect } =
    useTreasury();
  const { network, setNetwork } = useNetwork();
  const wallet = wallets[0];

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex min-w-0 flex-col">
            <p className="text-sm font-medium tracking-tight">MorokPay</p>
            <p className="text-xs text-muted-foreground">
              {network === "sepolia" ? "Private USDC · testnet" : "Private USDC"}
            </p>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground",
                  pathname === item.href && "bg-muted text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <ToggleGroup
            aria-label="Network"
            spacing={0}
            size="sm"
            variant="outline"
            value={[network]}
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
        </div>
        {session ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-10"
            onClick={disconnect}
          >
            {shortenAddress(session.address)}
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            className="min-h-10"
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
              "rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground",
              pathname === item.href && "bg-muted text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
