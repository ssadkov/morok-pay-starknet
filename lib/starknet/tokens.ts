import { type AppNetwork } from "@/lib/network";
import { starknetOf } from "./constants";

export type ShieldTokenId = "usdc" | "strkbtc";

export type ShieldToken = {
  id: ShieldTokenId;
  symbol: string;
  decimals: number;
  address: string;
};

export const STRKBTC_ADDRESS =
  "0x0787150e306e6EaE6E3f79dEA881770E8bbFF2c1b8EB490F969669EE945b3135";

const STRKBTC_TOKEN: ShieldToken = {
  id: "strkbtc",
  symbol: "strkBTC",
  decimals: 8,
  address: STRKBTC_ADDRESS,
};

export function listShieldTokens(network: AppNetwork): ShieldToken[] {
  const usdc = getShieldToken("usdc", network);
  if (network === "sepolia") return [usdc];
  return [usdc, STRKBTC_TOKEN];
}

export function getShieldToken(
  id: ShieldTokenId,
  network: AppNetwork,
): ShieldToken {
  if (id === "strkbtc") return STRKBTC_TOKEN;
  return {
    id: "usdc",
    symbol: "USDC",
    decimals: 6,
    address: starknetOf(network).usdc,
  };
}

export function shieldTokenAddresses(network: AppNetwork): string[] {
  return listShieldTokens(network).map((token) => token.address);
}
