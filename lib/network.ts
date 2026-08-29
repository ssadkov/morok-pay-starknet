export type AppNetwork = "mainnet" | "sepolia";

export const NETWORK_STORAGE_KEY = "morokpay.network.v2";
export const NETWORK_CHANGE_EVENT = "morokpay-network";

/**
 * Mainnet by default, not Sepolia - this is where the contest and real
 * donations live now. `NEXT_PUBLIC_STARKNET_NETWORK=sepolia` opts a
 * deployment (or a local .env.local) back into testnet explicitly; anything
 * else, including the variable being unset, falls through to mainnet rather
 * than depending on every environment having it configured correctly.
 */
export function defaultAppNetwork(): AppNetwork {
  return process.env.NEXT_PUBLIC_STARKNET_NETWORK === "sepolia"
    ? "sepolia"
    : "mainnet";
}

export function parseAppNetwork(
  value: string | null,
  fallback = defaultAppNetwork(),
): AppNetwork {
  if (value == null || value === "") return fallback;
  if (value === "mainnet" || value === "sepolia") return value;
  throw new Error("Invalid network");
}

export function readStoredNetwork(): AppNetwork {
  if (typeof window === "undefined") return defaultAppNetwork();
  try {
    return parseAppNetwork(
      window.localStorage.getItem(NETWORK_STORAGE_KEY),
      defaultAppNetwork(),
    );
  } catch {
    return defaultAppNetwork();
  }
}

export function writeStoredNetwork(network: AppNetwork) {
  window.localStorage.setItem(NETWORK_STORAGE_KEY, network);
  window.dispatchEvent(new Event(NETWORK_CHANGE_EVENT));
}

export function subscribeNetwork(onStoreChange: () => void) {
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(NETWORK_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(NETWORK_CHANGE_EVENT, handler);
  };
}
