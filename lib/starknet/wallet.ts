import { createStore } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import {
  constants,
  validateAndParseAddress,
  walletV6,
  WalletAccountV6,
} from "starknet";

import { STARKNET_NETWORK } from "./constants";
import { createProvider } from "./status";

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function listReadyWallets(wallets: WalletWithStarknetFeatures[]) {
  return wallets
    .filter((wallet) => !normalizeName(wallet.name).includes("metamask"))
    .slice()
    .sort((left, right) => readyScore(left) - readyScore(right));
}

function readyScore(wallet: WalletWithStarknetFeatures) {
  const id = normalizeName(wallet.name);
  if (id.includes("ready") || id.includes("argent")) return 0;
  return 1;
}

export function expectedChainId() {
  return STARKNET_NETWORK === "sepolia"
    ? constants.StarknetChainId.SN_SEPOLIA
    : constants.StarknetChainId.SN_MAIN;
}

export async function connectReadyWallet(wallet: WalletWithStarknetFeatures) {
  const account = await WalletAccountV6.connect(createProvider(), wallet);
  if (!account.address) {
    throw new Error("This wallet is not compatible with Wallet API v6");
  }

  let chainId = String(await walletV6.requestChainId(wallet));
  if (chainId !== expectedChainId()) {
    const switched = await account.switchStarknetChain(expectedChainId());
    if (!switched) {
      throw new Error(
        `Switch Ready to Starknet ${STARKNET_NETWORK} and try again`,
      );
    }
    chainId = String(await walletV6.requestChainId(wallet));
  }

  return {
    account,
    address: validateAndParseAddress(account.address),
    chainId,
    wallet,
  };
}

export function watchWallets(
  onChange: (wallets: WalletWithStarknetFeatures[]) => void,
) {
  const store = createStore({ eip1193Adapters: [] });
  onChange(store.getWallets().slice());
  return store.subscribe((next) => onChange(next.slice()));
}
