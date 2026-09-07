import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { base, baseSepolia } from "wagmi/chains";

import { cctpOf } from "@/lib/cctp/constants";
import {
  defaultAppNetwork,
  readStoredNetwork,
  subscribeNetwork,
  writeNetworkCookie,
  writeStoredNetwork,
  type AppNetwork,
} from "@/lib/network";
import { starknetOf } from "@/lib/starknet/constants";

type NetworkContextValue = {
  network: AppNetwork;
  setNetwork: (network: AppNetwork) => void;
  starknet: ReturnType<typeof starknetOf>;
  cctp: ReturnType<typeof cctpOf>;
  baseChain: typeof base | typeof baseSepolia;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({
  children,
  initialNetwork,
}: {
  children: ReactNode;
  initialNetwork?: AppNetwork;
}) {
  /* The server snapshot is what hydration renders, so it has to agree with
     localStorage or the whole page repaints a frame later. `initialNetwork`
     is the same choice read from a cookie during SSR; the fallback is for a
     visitor whose localStorage predates the cookie. */
  const network = useSyncExternalStore(
    subscribeNetwork,
    readStoredNetwork,
    () => initialNetwork ?? defaultAppNetwork(),
  );

  // Backfills that one-time gap, so the next load renders it right.
  useEffect(() => {
    if (network !== initialNetwork) writeNetworkCookie(network);
  }, [network, initialNetwork]);

  const value = useMemo<NetworkContextValue>(
    () => ({
      network,
      setNetwork: writeStoredNetwork,
      starknet: starknetOf(network),
      cctp: cctpOf(network),
      baseChain: network === "sepolia" ? baseSepolia : base,
    }),
    [network],
  );

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error("useNetwork must be used inside NetworkProvider");
  }
  return context;
}
