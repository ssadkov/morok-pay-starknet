import { RpcProvider } from "starknet";

import { defaultAppNetwork, type AppNetwork } from "@/lib/network";

import { STRK_ADDRESS, starknetOf } from "./constants";
import { STRKBTC_ADDRESS, type ShieldToken } from "./tokens";

export type AccountDeployStatus = "deployed" | "undeployed" | "unknown";

export type AccountSnapshot = {
  status: AccountDeployStatus;
  strkWei: bigint;
  usdcRaw: bigint;
  strkBtcRaw: bigint;
};

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    code?: number;
    message?: string;
    baseError?: { code?: number; message?: string };
  };
  if (record.code === 20 || record.baseError?.code === 20) return true;
  const message = `${record.message ?? ""} ${record.baseError?.message ?? ""}`;
  return (
    message.includes("Contract not found") ||
    message.includes("CONTRACT_NOT_FOUND")
  );
}

function u256(low: string, high = "0x0"): bigint {
  return BigInt(low) + (BigInt(high) << BigInt(128));
}

export function createProvider(network: AppNetwork = defaultAppNetwork()) {
  return new RpcProvider({ nodeUrl: starknetOf(network).rpc });
}

async function readTokenBalance(
  provider: RpcProvider,
  token: string,
  address: string,
): Promise<bigint> {
  const result = await provider.callContract({
    contractAddress: token,
    entrypoint: "balance_of",
    calldata: [address],
  });
  const values = Array.isArray(result)
    ? result
    : ((result as { result?: string[] }).result ?? []);
  const [low, high] = values;
  if (!low) return BigInt(0);
  return u256(String(low), String(high ?? "0x0"));
}

export async function getAccountSnapshot(
  address: string,
  network: AppNetwork = defaultAppNetwork(),
): Promise<AccountSnapshot> {
  const provider = createProvider(network);
  const usdc = starknetOf(network).usdc;
  let status: AccountDeployStatus = "undeployed";

  try {
    await provider.getClassHashAt(address);
    status = "deployed";
  } catch (error) {
    status = isNotFound(error) ? "undeployed" : "unknown";
  }

  let strkWei = BigInt(0);
  let usdcRaw = BigInt(0);
  let strkBtcRaw = BigInt(0);
  try {
    strkWei = await readTokenBalance(provider, STRK_ADDRESS, address);
  } catch {
    // Keep 0 if the gas token is unreachable.
  }
  try {
    usdcRaw = await readTokenBalance(provider, usdc, address);
  } catch {
    // Keep 0 until Circle USDC is minted to this account.
  }
  if (network !== "sepolia") {
    try {
      strkBtcRaw = await readTokenBalance(provider, STRKBTC_ADDRESS, address);
    } catch {
      // Keep 0 until strkBTC is bridged to this account.
    }
  }

  return { status, strkWei, usdcRaw, strkBtcRaw };
}

export function formatToken(amount: bigint, decimals: number, maxFrac = 4): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = amount / base;
  const frac = amount % base;
  if (frac === BigInt(0)) return whole.toString();
  const padded = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${padded.slice(0, maxFrac)}`;
}

export function formatStrk(wei: bigint): string {
  return formatToken(wei, 18);
}

export function formatUsdc(raw: bigint): string {
  return formatToken(raw, 6, 2);
}

export function formatStrkBtc(raw: bigint): string {
  return formatToken(raw, 8, 8);
}

export function formatShieldAmount(raw: bigint, token: ShieldToken): string {
  return formatToken(raw, token.decimals, token.id === "usdc" ? 2 : 8);
}
