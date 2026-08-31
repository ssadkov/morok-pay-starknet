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
import { RpcProvider, type WalletAccountV6 } from "starknet";
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
import { privacySdkOf } from "@/lib/privacy/network";
import {
  createEvmStrk20Account,
  type MorokPrivateAccount,
  type SignatureProgress,
} from "@/lib/privacy/evm-strk20-account";
import { privateBalanceFromEntries } from "@/lib/starknet/actions";
import { starknetOf, STRK_ADDRESS } from "@/lib/starknet/constants";
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
  forgetReadyWallet,
  lastReadyWalletName,
  listReadyWallets,
  reconnectReadyWalletSilently,
  rememberReadyWallet,
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
  /**
   * False while the account is deployed but not registered in the pool. It can
   * still hold, receive, swap and send in public; nothing private will work
   * until it activates, and the pool would reject it with an error nobody can
   * read.
   */
  privacyReady: boolean;
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
  /** Call wallet_strk20Balances (Ready X prompt). Default true. */
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
  /** Set whenever wagmi holds a connection, session or not. */
  evmConnectedAddress: string | null;
  /**
   * Where a bridge should deliver. Known from the EVM address alone, so it is
   * available before the account is deployed - which is the whole point:
   * an ERC-20 balance needs no code at the address, so USDC can arrive first
   * and pay for the deployment afterwards.
   */
  evmStarknetAddress: string | null;
  evmGate: EvmOnboardingGate | null;
  connectEvm: () => Promise<void>;
  dismissEvmGate: () => void;
  disconnect: () => void;
  refreshBalances: (options?: RefreshBalancesOptions) => Promise<void>;
  /** Which wallet prompt an EVM session is waiting on, null when idle. */
  signatureProgress: SignatureProgress | null;
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
  const [evmStarknetAddress, setEvmStarknetAddress] = useState<string | null>(
    null,
  );
  const [signatureProgress, setSignatureProgress] =
    useState<SignatureProgress | null>(null);
  const [balances, setBalances] = useState<TreasuryBalances | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [tokenId, setTokenId] = useState<ShieldTokenId>("usdc");
  const previousPrivateUsdc = useRef<bigint | null>(null);
  const previousAddress = useRef<string | null>(null);
  const lastPrivate = useRef<LastPrivate>({ ...EMPTY_PRIVATE });
  const sessionRef = useRef(session);
  const privateInFlight = useRef(false);
  // A restore runs at most once per network, and never after an explicit
  // disconnect - otherwise disconnecting would immediately reconnect.
  const restoreAttempted = useRef(false);

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

  /* Derived from the connected address through the factory's own view, so it
     agrees with whatever the factory would deploy rather than guessing at it. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!connectedEvmAddress) {
        if (!cancelled) setEvmStarknetAddress(null);
        return;
      }
      try {
        const inspection = await inspectEth712Account(
          connectedEvmAddress,
          new RpcProvider({ nodeUrl: starknetOf(network).rpc }),
          privacySdkOf(network).accountFactory,
        );
        if (!cancelled) setEvmStarknetAddress(inspection.starknetAddress);
      } catch {
        if (!cancelled) setEvmStarknetAddress(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectedEvmAddress, network]);

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
    /* Not gated on the session being an EVM one. Connecting a wallet that
       still needs onboarding leaves wagmi connected with no session at all -
       dismissing the gate used to strand it there, connected and
       undisconnectable, with the header showing the connect buttons again. */
    if (evmConnected) disconnectEvmWallet();
    forgetReadyWallet();
    restoreAttempted.current = true;
    previousPrivateUsdc.current = null;
    previousAddress.current = null;
    lastPrivate.current = { ...EMPTY_PRIVATE };
    setSession(null);
    setBalances(null);
    setConnectError(null);
    setEvmGate(null);
  }, [disconnectEvmWallet, evmConnected, session]);

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
    // The other network's wallet may still be authorized, so let the restore
    // below run again rather than forcing a manual reconnect.
    restoreAttempted.current = false;
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
              "Funded, but not deployed. Send one outgoing transaction in Ready X first.";
          } else {
            const registration = await poolRegistration(
              network,
              current.address,
            );
            if (registration === "unregistered") {
              privateError =
                "Enable Private in Ready X first. Turn on Smart Account, then open Protected tokens and confirm the one-time activation.";
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
        rememberReadyWallet(wallet.name);
        setSession({ ...next, kind: "ready" });
        setEvmGate(null);
      } catch (error) {
        setConnectError(
          error instanceof Error ? error.message : "Could not connect Ready X",
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

      const sdk = privacySdkOf(network);
      const inspection = await inspectEth712Account(
        evmAddress,
        new RpcProvider({ nodeUrl: starknetOf(network).rpc }),
        sdk.accountFactory,
      );
      const registration = inspection.deployed
        ? await poolRegistration(network, inspection.starknetAddress)
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
      /* A partial account still gets a session - it can swap and receive a
         bridge - but the gate goes up too, since activating is the next thing
         it needs and there would otherwise be nowhere to start it from. */
      if (readiness.status === "partial") {
        setEvmGate({
          address: readiness.starknetAddress,
          reason: readiness.reason,
          message: readiness.message,
        });
      }

      const account = createEvmStrk20Account({
        starknetAddress: readiness.starknetAddress,
        evmAddress,
        evmChainId,
        network,
        signTypedData: (typedData) => signTypedDataAsync(typedData as never),
        onSignatureProgress: setSignatureProgress,
      });
      setSession({
        kind: "evm",
        account,
        address: readiness.starknetAddress,
        chainId: sdk.snChainName,
        evmAddress,
        evmChainId,
        privacyReady: readiness.status === "ready",
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

  /**
   * Rebuild the session after a reload instead of showing a disconnected app
   * to someone whose wallet is still authorized. Both paths are silent: wagmi
   * already restored the EVM connection by itself, and Ready X reconnects
   * through connectSilent. Nothing here opens a wallet dialog, sets
   * connectError, or raises the onboarding gate - a page load must not
   * interrupt, so any failure just leaves the Connect buttons in place.
   *
   * The private viewing key is deliberately not restored: it lives only in
   * the closure created by createEvmStrk20Account, so the first private
   * balance read after a reload asks for that signature again.
   */
  useEffect(() => {
    if (session || connecting || evmConnecting) return;
    if (restoreAttempted.current) return;
    let cancelled = false;

    async function restore() {
      if (evmConnected && connectedEvmAddress && connectedEvmChainId) {
        restoreAttempted.current = true;
        try {
          const sdk = privacySdkOf(network);
          const inspection = await inspectEth712Account(
            connectedEvmAddress!,
            new RpcProvider({ nodeUrl: starknetOf(network).rpc }),
            sdk.accountFactory,
          );
          if (!inspection.deployed) return;
          const registration = await poolRegistration(
            network,
            inspection.starknetAddress,
          );
          const readiness = classifyEvmReadiness(inspection, registration);
          /* Onboarding is an interactive flow, so a reload never resumes one.
             A partial account is not mid-flow though - it is deployed and can
             work in public - so it restores like any other, silently and
             without raising the gate at somebody who only came back to look at
             a balance. */
          if (readiness.status === "onboarding" || cancelled) return;
          setSession({
            kind: "evm",
            account: createEvmStrk20Account({
              starknetAddress: readiness.starknetAddress,
              evmAddress: connectedEvmAddress!,
              evmChainId: connectedEvmChainId!,
              network,
              signTypedData: (typedData) => signTypedDataAsync(typedData as never),
              onSignatureProgress: setSignatureProgress,
            }),
            address: readiness.starknetAddress,
            chainId: sdk.snChainName,
            evmAddress: connectedEvmAddress!,
            evmChainId: connectedEvmChainId!,
            privacyReady: readiness.status === "ready",
          });
        } catch {
          // Leave the app disconnected; the Connect buttons still work.
        }
        return;
      }

      const remembered = lastReadyWalletName();
      if (!remembered) return;
      const wallet = wallets.find((candidate) => candidate.name === remembered);
      if (!wallet) return;
      restoreAttempted.current = true;
      const next = await reconnectReadyWalletSilently(wallet, network);
      if (next && !cancelled) setSession({ ...next, kind: "ready" });
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [
    session,
    connecting,
    evmConnecting,
    evmConnected,
    connectedEvmAddress,
    connectedEvmChainId,
    network,
    signTypedDataAsync,
    wallets,
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
      evmStarknetAddress,
      evmGate,
      connectEvm,
      dismissEvmGate: () => setEvmGate(null),
      disconnect,
      refreshBalances,
      signatureProgress,
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
      evmStarknetAddress,
      evmGate,
      connectEvm,
      disconnect,
      refreshBalances,
      signatureProgress,
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
