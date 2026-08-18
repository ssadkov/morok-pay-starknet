import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { base, baseSepolia } from "wagmi/chains";

import { cctpOf } from "@/lib/cctp/constants";
import {
  defaultAppNetwork,
  readStoredNetwork,
  subscribeNetwork,
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

export function NetworkProvider({ children }: { children: ReactNode }) {
  const network = useSyncExternalStore(
    subscribeNetwork,
    readStoredNetwork,
    defaultAppNetwork,
  );

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
