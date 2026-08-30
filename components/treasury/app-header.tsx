"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BlocksIcon, ChevronDownIcon, CopyIcon, LogOutIcon, WalletIcon } from "lucide-react";
import { toast } from "sonner";

import { MorokMark } from "@/components/brand/morok-mark";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { shortenAddress } from "@/lib/format";
import type { AppNetwork } from "@/lib/network";

const NAV = [
  { href: "/pay", label: "Donate" },
  { href: "/sell", label: "My QR" },
  { href: "/treasury", label: "Top up" },
] as const;

/** Top up is the Base-bridge and testnet-faucet page; not a mainnet path yet. */
function navFor(network: AppNetwork) {
  return network === "mainnet"
    ? NAV.filter((item) => item.href !== "/treasury")
    : NAV;
}

async function copyAddress(value: string, message: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  } catch {
    toast.error("Could not copy address");
  }
}

export function AppHeader() {
  const pathname = usePathname();
  const {
    session,
    wallets,
    connecting,
    evmConnecting,
    connectWallet,
    connectEvm,
    evmConnectedAddress,
    disconnect,
  } = useTreasury();
  const { network, setNetwork } = useNetwork();
  const nav = navFor(network);
  const wallet = wallets[0];

  return (
    <header className="border-b border-border/80 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto grid min-h-16 max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-3 sm:flex sm:gap-4 md:px-6">
        <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-auto sm:flex-1">
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
                  ? "Private donations · testnet"
                  : "Private donations"}
              </span>
            </span>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
            {nav.map((item) => (
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
        {/* Neither the dropdown nor the connect buttons have a grid
            position, so on mobile they land wherever auto-placement finds
            room - which turned out to be the same cell as the logo, an
            "auto" column sized to the buttons' full content width squeezing
            the logo's 1fr column to 0. Row 3 gives them a row of their own;
            sm:contents removes this wrapper at the flex breakpoint so it
            never affects the desktop layout. */}
        <div className="col-span-2 row-start-3 flex flex-wrap items-center gap-2 sm:col-auto sm:row-auto sm:contents">
        {session ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline" size="lg" className="min-h-10" />
              }
            >
              <span className="max-w-32 truncate">
                {session.kind === "evm" ? "EVM · " : ""}
                {shortenAddress(
                  session.kind === "evm" ? session.evmAddress : session.address,
                )}
              </span>
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {session.kind === "evm" ? (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>EVM address</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => {
                      void copyAddress(session.evmAddress, "EVM address copied");
                    }}
                  >
                    <CopyIcon />
                    {shortenAddress(session.evmAddress)}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              ) : null}
              <DropdownMenuGroup>
                <DropdownMenuLabel>Starknet address</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    void copyAddress(session.address, "Starknet address copied");
                  }}
                >
                  <CopyIcon />
                  {shortenAddress(session.address)}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={disconnect}>
                <LogOutIcon />
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Button
              type="button"
              size="lg"
              className="min-h-10 px-3 text-sm sm:px-4"
              disabled={!wallet || connecting || evmConnecting}
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
              {connecting ? "Connecting" : "Connect Ready X"}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-10 px-3 text-sm sm:px-4"
              disabled={connecting || evmConnecting}
              aria-busy={evmConnecting}
              onClick={() => void connectEvm()}
            >
              {evmConnecting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <BlocksIcon data-icon="inline-start" />
              )}
              {evmConnecting ? "Checking" : "Connect EVM wallet"}
            </Button>
            {/* A wallet can be connected with no session at all - dismissing
                the onboarding gate leaves it exactly there. Without this the
                only way back out is clearing site data. */}
            {evmConnectedAddress ? (
              <Button
                type="button"
                size="lg"
                variant="ghost"
                className="min-h-10 px-3 text-sm sm:px-4"
                onClick={disconnect}
              >
                <LogOutIcon data-icon="inline-start" />
                Disconnect {shortenAddress(evmConnectedAddress)}
              </Button>
            ) : null}
          </div>
        )}
        </div>
      </div>
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-6xl gap-1 px-4 pb-3 sm:hidden md:px-6"
      >
        {nav.map((item) => (
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
