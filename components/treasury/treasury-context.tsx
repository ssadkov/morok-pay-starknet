"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import type { WalletAccountV6 } from "starknet";

import { useNetwork } from "@/components/network-provider";
import { reconcilePrivateBalance } from "@/lib/pay/activity";
import { privateBalanceFromEntries } from "@/lib/starknet/actions";
import { formatStrk20Error } from "@/lib/starknet/errors";
import {
  getAccountSnapshot,
  type AccountSnapshot,
} from "@/lib/starknet/status";
import {
  getShieldToken,
  listShieldTokens,
  shieldTokenAddresses,
  type ShieldToken,
  type ShieldTokenId,
} from "@/lib/starknet/tokens";
import {
  connectReadyWallet,
  listReadyWallets,
  watchWallets,
} from "@/lib/starknet/wallet";

export type ReadySession = {
  account: WalletAccountV6;
  wallet: WalletWithStarknetFeatures;
  address: string;
  chainId: string;
};

export type TreasuryBalances = AccountSnapshot & {
  privateUsdc: bigint;
  privateStrkBtc: bigint;
  privateError: string | null;
};

type TreasuryContextValue = {
  wallets: WalletWithStarknetFeatures[];
  session: ReadySession | null;
  connecting: boolean;
  connectError: string | null;
  balances: TreasuryBalances | null;
  balancesLoading: boolean;
  tokens: ShieldToken[];
  token: ShieldToken;
  setTokenId: (id: ShieldTokenId) => void;
  publicRaw: bigint;
  privateRaw: bigint;
  connectWallet: (wallet: WalletWithStarknetFeatures) => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
};

const TreasuryContext = createContext<TreasuryContextValue | null>(null);

const EMPTY_BALANCES: TreasuryBalances = {
  status: "unknown",
  strkWei: BigInt(0),
  usdcRaw: BigInt(0),
  strkBtcRaw: BigInt(0),
  privateUsdc: BigInt(0),
  privateStrkBtc: BigInt(0),
  privateError: null,
};

function publicBalance(balances: TreasuryBalances | null, token: ShieldToken) {
  if (!balances) return BigInt(0);
  return token.id === "strkbtc" ? balances.strkBtcRaw : balances.usdcRaw;
}

function privateBalance(balances: TreasuryBalances | null, token: ShieldToken) {
  if (!balances) return BigInt(0);
  return token.id === "strkbtc" ? balances.privateStrkBtc : balances.privateUsdc;
}

export function TreasuryProvider({ children }: { children: ReactNode }) {
  const { network } = useNetwork();
  const tokens = useMemo(() => listShieldTokens(network), [network]);
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);
  const [session, setSession] = useState<ReadySession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [balances, setBalances] = useState<TreasuryBalances | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [tokenId, setTokenId] = useState<ShieldTokenId>("usdc");
  const previousPrivateUsdc = useRef<bigint | null>(null);
  const previousAddress = useRef<string | null>(null);

  const token = getShieldToken(
    network === "sepolia" && tokenId === "strkbtc" ? "usdc" : tokenId,
    network,
  );

  useEffect(() => {
    return watchWallets((next) => setWallets(listReadyWallets(next)));
  }, []);

  useEffect(() => {
    if (!session) return;
    const account = session.account;
    return account.onChange((change) => {
      const nextAccount = change.accounts?.[0];
      if (!nextAccount) return;
      setSession((current) => {
        if (!current) return current;
        const chain = nextAccount.chains?.[0];
        return {
          ...current,
          address: nextAccount.address || current.address,
          chainId: chain
            ? String(chain).replace(/^starknet:/, "")
            : current.chainId,
        };
      });
    });
  }, [session?.account]);

  const disconnect = useCallback(() => {
    session?.account.unsubscribeChange();
    previousPrivateUsdc.current = null;
    previousAddress.current = null;
    setSession(null);
    setBalances(null);
    setConnectError(null);
  }, [session]);

  const networkReady = useRef(false);
  useEffect(() => {
    if (!networkReady.current) {
      networkReady.current = true;
      return;
    }
    setTokenId("usdc");
    previousPrivateUsdc.current = null;
    previousAddress.current = null;
    session?.account.unsubscribeChange();
    setSession(null);
    setBalances(null);
    setConnectError(null);
    // Disconnect when the user switches Starknet + Base together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  const refreshBalances = useCallback(async () => {
    if (!session) return;
    setBalancesLoading(true);
    try {
      const snapshot = await getAccountSnapshot(session.address, network);
      let privateUsdc = BigInt(0);
      let privateStrkBtc = BigInt(0);
      let privateError: string | null = null;
      try {
        const entries = await session.account.strk20Balances(
          shieldTokenAddresses(network),
        );
        privateUsdc = privateBalanceFromEntries(
          entries,
          getShieldToken("usdc", network).address,
        );
        privateStrkBtc = privateBalanceFromEntries(
          entries,
          getShieldToken("strkbtc", network).address,
        );
      } catch (error) {
        privateError = formatStrk20Error(error, "balance");
      }
      setBalances({
        ...snapshot,
        privateUsdc,
        privateStrkBtc,
        privateError,
      });
      if (!privateError) {
        const sameAccount = previousAddress.current === session.address;
        if (sameAccount && previousPrivateUsdc.current !== null) {
          reconcilePrivateBalance({
            network,
            address: session.address,
            previousRaw: previousPrivateUsdc.current,
            nextRaw: privateUsdc,
          });
        }
        previousAddress.current = session.address;
        previousPrivateUsdc.current = privateUsdc;
      }
    } catch {
      setBalances({ ...EMPTY_BALANCES, status: "unknown" });
    } finally {
      setBalancesLoading(false);
    }
  }, [session, network]);

  useEffect(() => {
    if (!session) return;
    void refreshBalances();
    const timer = window.setInterval(() => {
      void refreshBalances();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [session, refreshBalances]);

  const connectWallet = useCallback(
    async (wallet: WalletWithStarknetFeatures) => {
      setConnecting(true);
      setConnectError(null);
      try {
        const next = await connectReadyWallet(wallet, network);
        setSession(next);
      } catch (error) {
        setConnectError(
          error instanceof Error ? error.message : "Could not connect Ready",
        );
      } finally {
        setConnecting(false);
      }
    },
    [network],
  );

  const value = useMemo(
    () => ({
      wallets,
      session,
      connecting,
      connectError,
      balances,
      balancesLoading,
      tokens,
      token,
      setTokenId,
      publicRaw: publicBalance(balances, token),
      privateRaw: privateBalance(balances, token),
      connectWallet,
      disconnect,
      refreshBalances,
    }),
    [
      wallets,
      session,
      connecting,
      connectError,
      balances,
      balancesLoading,
      tokens,
      token,
      connectWallet,
      disconnect,
      refreshBalances,
    ],
  );

  return (
    <TreasuryContext.Provider value={value}>{children}</TreasuryContext.Provider>
  );
}

export function useTreasury() {
  const context = useContext(TreasuryContext);
  if (!context) {
    throw new Error("useTreasury must be used inside TreasuryProvider");
  }
  return context;
}
