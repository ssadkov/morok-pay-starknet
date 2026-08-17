"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import type { WalletAccountV6 } from "starknet";

import { USDC_ADDRESS } from "@/lib/starknet/constants";
import { privateUsdcFromBalances } from "@/lib/starknet/actions";
import {
  getAccountSnapshot,
  type AccountSnapshot,
} from "@/lib/starknet/status";
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
  privateError: string | null;
};

type TreasuryContextValue = {
  wallets: WalletWithStarknetFeatures[];
  session: ReadySession | null;
  connecting: boolean;
  connectError: string | null;
  balances: TreasuryBalances | null;
  balancesLoading: boolean;
  connectWallet: (wallet: WalletWithStarknetFeatures) => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
};

const TreasuryContext = createContext<TreasuryContextValue | null>(null);

const EMPTY_BALANCES: TreasuryBalances = {
  status: "unknown",
  strkWei: BigInt(0),
  usdcRaw: BigInt(0),
  privateUsdc: BigInt(0),
  privateError: null,
};

export function TreasuryProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);
  const [session, setSession] = useState<ReadySession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [balances, setBalances] = useState<TreasuryBalances | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);

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
    setSession(null);
    setBalances(null);
    setConnectError(null);
  }, [session]);

  const refreshBalances = useCallback(async () => {
    if (!session) return;
    setBalancesLoading(true);
    try {
      const snapshot = await getAccountSnapshot(session.address);
      let privateUsdc = BigInt(0);
      let privateError: string | null = null;
      try {
        const entries = await session.account.strk20Balances([USDC_ADDRESS]);
        privateUsdc = privateUsdcFromBalances(entries);
      } catch (error) {
        privateError =
          error instanceof Error
            ? error.message
            : "Ready could not read the private USDC balance";
      }
      setBalances({ ...snapshot, privateUsdc, privateError });
    } catch {
      setBalances({ ...EMPTY_BALANCES, status: "unknown" });
    } finally {
      setBalancesLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    void refreshBalances();
  }, [session, refreshBalances]);

  const connectWallet = useCallback(
    async (wallet: WalletWithStarknetFeatures) => {
      setConnecting(true);
      setConnectError(null);
      try {
        const next = await connectReadyWallet(wallet);
        setSession(next);
      } catch (error) {
        setConnectError(
          error instanceof Error ? error.message : "Could not connect Ready",
        );
      } finally {
        setConnecting(false);
      }
    },
    [],
  );

  const value = useMemo(
    () => ({
      wallets,
      session,
      connecting,
      connectError,
      balances,
      balancesLoading,
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
