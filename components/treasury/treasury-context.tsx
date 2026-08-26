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
import { useAccount, useConnect, useDisconnect as useEvmDisconnect, useSignTypedData } from "wagmi";

import { useNetwork } from "@/components/network-provider";
import {
  readPrivateBalanceSnapshot,
  reconcilePrivateBalance,
  reconcilePrivateBalanceAfterReconnect,
  writePrivateBalanceSnapshot,
} from "@/lib/pay/activity";
import { poolRegistration } from "@/lib/starknet/account-status";
import {
  inspectEth712Account,
} from "@/lib/privacy/eth712-account";
import { classifyEvmReadiness } from "@/lib/privacy/evm-onboarding";
import {
  createEvmStrk20Account,
  type MorokPrivateAccount,
} from "@/lib/privacy/evm-strk20-account";
import { privateBalanceFromEntries } from "@/lib/starknet/actions";
import { STRK_ADDRESS } from "@/lib/starknet/constants";
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
  kind: "ready";
  account: WalletAccountV6;
  wallet: WalletWithStarknetFeatures;
  address: string;
  chainId: string;
};

export type EvmSession = {
  kind: "evm";
  account: MorokPrivateAccount;
  address: string;
  chainId: string;
  evmAddress: string;
  evmChainId: number;
};

export type TreasurySession = ReadySession | EvmSession;

export type EvmOnboardingGate = {
  address: string;
  reason: "undeployed" | "upgrade" | "unregistered" | "unsupported" | "error";
  message: string;
};

export type TreasuryBalances = AccountSnapshot & {
  privateUsdc: bigint;
  privateStrk: bigint;
  privateStrkBtc: bigint;
  privateError: string | null;
};

export type RefreshBalancesOptions = {
  /** Call wallet_strk20Balances (Ready prompt). Default true. */
  private?: boolean;
};

type TreasuryContextValue = {
  wallets: WalletWithStarknetFeatures[];
  session: TreasurySession | null;
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
  evmConnecting: boolean;
  evmConnectedAddress: string | null;
  evmGate: EvmOnboardingGate | null;
  connectEvm: () => Promise<void>;
  dismissEvmGate: () => void;
  disconnect: () => void;
  refreshBalances: (options?: RefreshBalancesOptions) => Promise<void>;
};

const TreasuryContext = createContext<TreasuryContextValue | null>(null);

const EMPTY_BALANCES: TreasuryBalances = {
  status: "unknown",
  strkWei: BigInt(0),
  usdcRaw: BigInt(0),
  strkBtcRaw: BigInt(0),
  privateUsdc: BigInt(0),
  privateStrk: BigInt(0),
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

type LastPrivate = {
  usdc: bigint;
  strk: bigint;
  strkBtc: bigint;
  known: boolean;
};

const EMPTY_PRIVATE: LastPrivate = {
  usdc: BigInt(0),
  strk: BigInt(0),
  strkBtc: BigInt(0),
  known: false,
};

export function TreasuryProvider({ children }: { children: ReactNode }) {
  const { network } = useNetwork();
  const {
    address: connectedEvmAddress,
    chainId: connectedEvmChainId,
    isConnected: evmConnected,
  } = useAccount();
  const { connectors: evmConnectors, connectAsync: connectEvmAsync } = useConnect();
  const { disconnect: disconnectEvmWallet } = useEvmDisconnect();
  const { signTypedDataAsync } = useSignTypedData();
  const tokens = useMemo(() => listShieldTokens(network), [network]);
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);
  const [session, setSession] = useState<TreasurySession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [evmConnecting, setEvmConnecting] = useState(false);
  const [evmGate, setEvmGate] = useState<EvmOnboardingGate | null>(null);
  const [balances, setBalances] = useState<TreasuryBalances | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [tokenId, setTokenId] = useState<ShieldTokenId>("usdc");
  const previousPrivateUsdc = useRef<bigint | null>(null);
  const previousAddress = useRef<string | null>(null);
  const lastPrivate = useRef<LastPrivate>({ ...EMPTY_PRIVATE });
  const sessionRef = useRef(session);
  const privateInFlight = useRef(false);

  const token = getShieldToken(
    network === "sepolia" && tokenId === "strkbtc" ? "usdc" : tokenId,
    network,
  );

  // Keep refreshBalances stable across renders while it still sees the
  // current session. Declared first so later effects read a fresh ref.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (session?.kind !== "evm") return;
    if (
      !connectedEvmAddress ||
      !connectedEvmChainId ||
      connectedEvmAddress.toLowerCase() !== session.evmAddress.toLowerCase() ||
      connectedEvmChainId !== session.evmChainId
    ) {
      const clear = window.setTimeout(() => {
        setSession(null);
        setBalances(null);
      }, 0);
      return () => window.clearTimeout(clear);
    }
  }, [connectedEvmAddress, connectedEvmChainId, session]);

  useEffect(() => {
    return watchWallets((next) => setWallets(listReadyWallets(next)));
  }, []);

  const sessionAccount = session?.kind === "ready" ? session.account : null;
  useEffect(() => {
    if (!sessionAccount) return;
    const account = sessionAccount;
    return account.onChange((change) => {
      const nextAccount = change.accounts?.[0];
      if (!nextAccount) return;
      setSession((current) => {
        if (!current) return current;
        const chain = nextAccount.chains?.[0];
        return current.kind === "ready" ? {
          ...current,
          address: nextAccount.address || current.address,
          chainId: chain
            ? String(chain).replace(/^starknet:/, "")
            : current.chainId,
        } : current;
      });
    });
  }, [sessionAccount]);

  const disconnect = useCallback(() => {
    if (session?.kind === "ready") session.account.unsubscribeChange();
    if (session?.kind === "evm") disconnectEvmWallet();
    previousPrivateUsdc.current = null;
    previousAddress.current = null;
    lastPrivate.current = { ...EMPTY_PRIVATE };
    setSession(null);
    setBalances(null);
    setConnectError(null);
    setEvmGate(null);
  }, [disconnectEvmWallet, session]);

  const networkReady = useRef(false);
  useEffect(() => {
    if (!networkReady.current) {
      networkReady.current = true;
      return;
    }
    setTokenId("usdc");
    previousPrivateUsdc.current = null;
    previousAddress.current = null;
    lastPrivate.current = { ...EMPTY_PRIVATE };
    if (session?.kind === "ready") session.account.unsubscribeChange();
    setSession(null);
    setBalances(null);
    setConnectError(null);
    // Disconnect when the user switches Starknet + Base together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  const refreshBalances = useCallback(
    async (options?: RefreshBalancesOptions) => {
      const current = sessionRef.current;
      if (!current) return;
      const includePrivate = options?.private !== false;
      if (includePrivate) setBalancesLoading(true);
      try {
        const snapshot = await getAccountSnapshot(current.address, network);
        if (!includePrivate) {
          setBalances((prev) => ({
            ...snapshot,
            privateUsdc: prev?.privateUsdc ?? lastPrivate.current.usdc,
            privateStrk: prev?.privateStrk ?? lastPrivate.current.strk,
            privateStrkBtc:
              prev?.privateStrkBtc ?? lastPrivate.current.strkBtc,
            privateError: prev?.privateError ?? null,
          }));
          return;
        }
        if (privateInFlight.current) {
          setBalances((prev) => ({
            ...snapshot,
            privateUsdc: prev?.privateUsdc ?? lastPrivate.current.usdc,
            privateStrk: prev?.privateStrk ?? lastPrivate.current.strk,
            privateStrkBtc:
              prev?.privateStrkBtc ?? lastPrivate.current.strkBtc,
            privateError: prev?.privateError ?? null,
          }));
          return;
        }
        privateInFlight.current = true;
        let privateUsdc = lastPrivate.current.usdc;
        let privateStrk = lastPrivate.current.strk;
        let privateStrkBtc = lastPrivate.current.strkBtc;
        let privateError: string | null = null;
        try {
          if (snapshot.status === "undeployed") {
            privateError =
              "Funded, but not deployed. Send one outgoing transaction in Ready first.";
          } else {
            const registration = await poolRegistration(
              network,
              current.address,
            );
            if (registration === "unregistered") {
              privateError =
                "Enable Private in Ready first. Turn on Smart Account, then open Protected tokens and confirm the one-time activation.";
            } else {
              const entries = await current.account.strk20Balances([
                ...shieldTokenAddresses(network),
                STRK_ADDRESS,
              ]);
              privateUsdc = privateBalanceFromEntries(
                entries,
                getShieldToken("usdc", network).address,
              );
              privateStrk = privateBalanceFromEntries(entries, STRK_ADDRESS);
              privateStrkBtc = privateBalanceFromEntries(
                entries,
                getShieldToken("strkbtc", network).address,
              );
              lastPrivate.current = {
                usdc: privateUsdc,
                strk: privateStrk,
                strkBtc: privateStrkBtc,
                known: true,
              };
              const sameAccount = previousAddress.current === current.address;
              if (sameAccount && previousPrivateUsdc.current !== null) {
                reconcilePrivateBalance({
                  network,
                  address: current.address,
                  previousRaw: previousPrivateUsdc.current,
                  nextRaw: privateUsdc,
                });
              } else {
                const stored = readPrivateBalanceSnapshot(
                  network,
                  current.address,
                );
                if (stored !== null) {
                  reconcilePrivateBalanceAfterReconnect({
                    network,
                    address: current.address,
                    previousRaw: stored,
                    nextRaw: privateUsdc,
                  });
                }
              }
              writePrivateBalanceSnapshot(
                network,
                current.address,
                privateUsdc,
              );
              previousAddress.current = current.address;
              previousPrivateUsdc.current = privateUsdc;
            }
          }
        } catch (error) {
          if (!lastPrivate.current.known) {
            privateError = formatStrk20Error(error, "balance");
          }
        } finally {
          privateInFlight.current = false;
        }
        setBalances({
          ...snapshot,
          privateUsdc,
          privateStrk,
          privateStrkBtc,
          privateError,
        });
      } catch {
        setBalances({
          ...EMPTY_BALANCES,
          status: "unknown",
          privateUsdc: lastPrivate.current.usdc,
          privateStrk: lastPrivate.current.strk,
          privateStrkBtc: lastPrivate.current.strkBtc,
          privateError: lastPrivate.current.known
            ? null
            : "Could not load balances",
        });
      } finally {
        if (includePrivate) setBalancesLoading(false);
      }
    },
    [network],
  );

  useEffect(() => {
    if (!session?.address) return;
    const initial = window.setTimeout(() => {
      void refreshBalances({ private: true });
    }, 0);
    const timer = window.setInterval(() => {
      void refreshBalances({ private: false });
    }, 20_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [session?.address, refreshBalances]);

  const connectWallet = useCallback(
    async (wallet: WalletWithStarknetFeatures) => {
      setConnecting(true);
      setConnectError(null);
      try {
        const next = await connectReadyWallet(wallet, network);
        setSession({ ...next, kind: "ready" });
        setEvmGate(null);
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

  const connectEvm = useCallback(async () => {
    setEvmConnecting(true);
    setConnectError(null);
    setEvmGate(null);
    try {
      if (network !== "sepolia") {
        throw new Error("EVM wallet onboarding is available on Sepolia only.");
      }
      let evmAddress = connectedEvmAddress;
      let evmChainId = connectedEvmChainId;
      if (!evmConnected || !evmAddress || !evmChainId) {
        const connector = evmConnectors.find((candidate) => candidate.type === "injected") ?? evmConnectors[0];
        if (!connector) throw new Error("No injected EVM wallet was found.");
        const connected = await connectEvmAsync({ connector });
        evmAddress = connected.accounts[0];
        evmChainId = connected.chainId;
      }
      if (!evmAddress || !evmChainId) {
        throw new Error("The EVM wallet did not return an account.");
      }

      const inspection = await inspectEth712Account(evmAddress);
      const registration = inspection.deployed
        ? await poolRegistration("sepolia", inspection.starknetAddress)
        : null;
      const readiness = classifyEvmReadiness(inspection, registration);
      if (readiness.status === "onboarding") {
        setEvmGate({
          address: readiness.starknetAddress,
          reason: readiness.reason,
          message: readiness.message,
        });
        return;
      }

      const account = createEvmStrk20Account({
        starknetAddress: readiness.starknetAddress,
        evmAddress,
        evmChainId,
        signTypedData: (typedData) => signTypedDataAsync(typedData as never),
      });
      setSession({
        kind: "evm",
        account,
        address: readiness.starknetAddress,
        chainId: "SN_SEPOLIA",
        evmAddress,
        evmChainId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not connect EVM wallet";
      setConnectError(message);
      setEvmGate({ address: "", reason: "error", message });
    } finally {
      setEvmConnecting(false);
    }
  }, [
    connectedEvmAddress,
    connectedEvmChainId,
    connectEvmAsync,
    evmConnected,
    evmConnectors,
    network,
    signTypedDataAsync,
  ]);

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
      evmConnecting,
      evmConnectedAddress: connectedEvmAddress ?? null,
      evmGate,
      connectEvm,
      dismissEvmGate: () => setEvmGate(null),
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
      evmConnecting,
      connectedEvmAddress,
      evmGate,
      connectEvm,
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
