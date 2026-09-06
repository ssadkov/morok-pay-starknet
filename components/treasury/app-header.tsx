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

/**
 * Three doors, matching the home page. /stash had no nav entry at all - the
 * newest page was reachable only from a card someone had to land on first.
 *
 * Get STRK and Top up left for the balances card. They are things you go
 * looking for while staring at a number that is too small, which is exactly
 * where that card is, and five items plus two connect buttons wrapped every
 * label onto two lines at 1440px.
 */
const NAV = [
  { href: "/stash", label: "Send" },
  { href: "/pay", label: "Donate" },
  { href: "/sell", label: "My QR" },
] as const;

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
    evmStarknetAddress,
    disconnect,
  } = useTreasury();

  /* Both halves exist before a session does: the EVM address comes from the
     wallet, and the Starknet one is derived from it. A session additionally
     means the derived account is deployed on a class this app can drive,
     which a claim recipient may never need. */
  const evmAddress =
    session?.kind === "evm" ? session.evmAddress : evmConnectedAddress;
  const starknetAddress =
    session?.kind === "ready" || session?.kind === "evm"
      ? session.address
      : evmStarknetAddress;
  const { network, setNetwork } = useNetwork();
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
                  ? "Private USDC · testnet"
                  : "Private USDC on Starknet"}
              </span>
            </span>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
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
        {session || evmConnectedAddress ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline" size="lg" className="min-h-10" />
              }
            >
              <span className="max-w-32 truncate">
                {session?.kind === "ready" ? "" : "EVM · "}
                {shortenAddress(
                  session?.kind === "ready"
                    ? session.address
                    : (session?.kind === "evm" ? session.evmAddress : evmConnectedAddress) ?? "",
                )}
              </span>
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {evmAddress ? (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>EVM address</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => {
                      void copyAddress(evmAddress, "EVM address copied");
                    }}
                  >
                    <CopyIcon />
                    {shortenAddress(evmAddress)}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              ) : null}
              {starknetAddress ? (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Starknet address</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => {
                      void copyAddress(starknetAddress, "Starknet address copied");
                    }}
                  >
                    <CopyIcon />
                    {shortenAddress(starknetAddress)}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={disconnect}>
                <LogOutIcon />
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          /* flex-1 here fought the logo group's own flex-1: at sm the wrapper
             is `contents`, so the two became siblings splitting the free
             space and the buttons sat at the left of their half. Sized to
             content instead, the logo's flex-1 pushes them to the edge. */
          <div className="flex flex-1 flex-wrap items-center gap-2 sm:flex-none sm:justify-end">
            {/* EVM leads. The product's claim is that a Starknet wallet is
                not required, and putting Ready X first in the primary colour
                argued the opposite before anyone read a line of copy.
                Offering to connect a wallet that is already connected read as
                the app not noticing - the Disconnect button beside it named
                the very address it was asking for. A session is a different
                thing again: the account may simply not be deployed yet, and
                for a claim it does not need to be. */}
            {evmConnectedAddress ? null : (
              <Button
                type="button"
                size="lg"
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
            )}
            <Button
              type="button"
              size="lg"
              variant="outline"
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
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
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
