import { constants } from "starknet";

import type { AppNetwork } from "@/lib/network";
import { starknetOf } from "@/lib/starknet/constants";

export type PrivacySdkNetwork = {
  proverUrl: string;
  discoveryUrl: string;
  privacyRpcUrl: string;
  snChainName: "SN_MAIN" | "SN_SEPOLIA";
  starknetChainId:
    | typeof constants.StarknetChainId.SN_MAIN
    | typeof constants.StarknetChainId.SN_SEPOLIA;
  accountFactory: string;
  poolAddress: string;
};

/**
 * Mainnet and Sepolia proving/discovery are separate StarkWare deployments at
 * predictable hostnames (…alpha-mainnet.sw-dev.io / …alpha-sepolia.sw-dev.io).
 * Both are unauthenticated - confirmed against mainnet 2026-08-26 by
 * scripts/mainnet-prover-probe.mjs before any UI code pointed here.
 */
const SEPOLIA: PrivacySdkNetwork = {
  proverUrl: "https://transaction-prover.alpha-sepolia.sw-dev.io",
  discoveryUrl: "https://discovery-service.alpha-sepolia.sw-dev.io",
  privacyRpcUrl:
    process.env.NEXT_PUBLIC_STARKNET_PRIVACY_SEPOLIA_RPC_URL ??
    "https://api.zan.top/public/starknet-sepolia/rpc/v0_10",
  snChainName: "SN_SEPOLIA",
  starknetChainId: constants.StarknetChainId.SN_SEPOLIA,
  accountFactory: starknetOf("sepolia").accountFactory,
  poolAddress: starknetOf("sepolia").pool,
};

const MAINNET: PrivacySdkNetwork = {
  proverUrl: "https://transaction-prover.alpha-mainnet.sw-dev.io",
  discoveryUrl: "https://discovery-service.alpha-mainnet.sw-dev.io",
  privacyRpcUrl:
    process.env.NEXT_PUBLIC_STARKNET_PRIVACY_MAINNET_RPC_URL ??
    "https://api.zan.top/public/starknet-mainnet/rpc/v0_10",
  snChainName: "SN_MAIN",
  starknetChainId: constants.StarknetChainId.SN_MAIN,
  accountFactory: starknetOf("mainnet").accountFactory,
  poolAddress: starknetOf("mainnet").pool,
};

export function privacySdkOf(network: AppNetwork): PrivacySdkNetwork {
  return network === "mainnet" ? MAINNET : SEPOLIA;
}
