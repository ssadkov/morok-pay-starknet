import { zeroHash, type Address, type Hex } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";

import { waitForAttestation } from "@/lib/cctp/attestation";
import { starkAddressToBytes32 } from "@/lib/cctp/bytes";
import {
  CCTP_DOMAIN_BASE,
  CCTP_DOMAIN_STARKNET,
  CCTP_FINALITY_FAST,
  cctpFastMaxFee,
  erc20Abi,
  tokenMessengerV2Abi,
} from "@/lib/cctp/constants";
import type { AppNetwork } from "@/lib/network";
import { formatUsdc } from "@/lib/starknet/status";
import { wagmiConfig } from "@/lib/wagmi";

/**
 * Bringing USDC from Base to a Starknet address, in one place.
 *
 * There were two of these. The way in owns one, and it is the one that works:
 * Fast Transfer, with the mint relayed so an account that holds nothing on
 * Starknet can still be the one credited. The Top up page owned the other,
 * which was written first, never rendered, and had quietly settled on the
 * finalized threshold - thirteen to nineteen minutes instead of about one,
 * for no benefit anybody chose.
 *
 * Two copies of a sequence this long will always drift, and the drift is
 * invisible because both of them work. So the sequence lives here and the
 * screens keep only their own progress reporting.
 */

/** The chains this app's wagmi config knows; receipts are typed against it. */
type BaseChainId = (typeof wagmiConfig)["chains"][number]["id"];

/** Loosely typed so a caller can hand over wagmi's own hook unchanged. */
type WriteContract = (config: {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  chainId: number;
}) => Promise<Hex>;

export type BridgeResult = {
  /** The burn on Base. */
  burnHash: Hex;
  /** The relayed mint on Starknet. */
  transactionHash: string;
  /** What was actually delivered, once Circle's fee is taken off. */
  deliveredAtLeast: bigint;
};

export async function bridgeUsdcFromBase(args: {
  network: AppNetwork;
  /** USDC to send, before Circle's transfer fee. */
  amount: bigint;
  /** Starknet address to credit. Fixed on Base; nothing later can redirect it. */
  destination: string;
  usdc: Address;
  messenger: Address;
  baseChainId: BaseChainId;
  /** Where the wallet is now, so the switch is only asked for when needed. */
  currentChainId?: number;
  /** Skips the approval when the messenger is already allowed enough. */
  allowance?: bigint;
  /** Checked before anything is signed, when the caller knows it. */
  baseBalance?: bigint;
  switchChain: (chainId: number) => Promise<unknown>;
  writeContract: WriteContract;
  onProgress?: (step: string) => void;
  onBurn?: (hash: Hex) => void;
  /**
   * Handed the attestation before delivery is attempted, so a caller can
   * retry the last step on its own. Circle has already burned by then: the
   * money exists and is owed to the destination, and only the relayed mint is
   * outstanding. Losing that pair to a failed fetch would strand it.
   */
  onAttested?: (attested: { message: string; attestation: string }) => void;
}): Promise<BridgeResult> {
  const progress = args.onProgress ?? (() => {});
  const maxFee = cctpFastMaxFee(args.amount);

  /* Circle's fee has a floor, so a small enough transfer arrives as mostly
     fee. Refusing early is kinder than delivering dust. */
  if (args.amount <= maxFee * BigInt(2)) {
    throw new Error(
      `Too small to bridge - send at least ${formatUsdc(maxFee * BigInt(3))} USDC`,
    );
  }
  if (args.baseBalance !== undefined && args.baseBalance < args.amount) {
    throw new Error(
      `Only ${formatUsdc(args.baseBalance)} USDC on Base in this wallet`,
    );
  }

  if (args.currentChainId !== args.baseChainId) {
    progress("Switch to Base in your wallet");
    await args.switchChain(args.baseChainId);
  }

  if ((args.allowance ?? BigInt(0)) < args.amount) {
    progress("Approve USDC on Base");
    const approveHash = await args.writeContract({
      address: args.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [args.messenger, args.amount],
      chainId: args.baseChainId,
    });
    await waitForTransactionReceipt(wagmiConfig, {
      hash: approveHash,
      chainId: args.baseChainId,
    });
  }

  progress("Send USDC from Base");
  const burnHash = await args.writeContract({
    address: args.messenger,
    abi: tokenMessengerV2Abi,
    functionName: "depositForBurn",
    args: [
      args.amount,
      CCTP_DOMAIN_STARKNET,
      starkAddressToBytes32(args.destination),
      args.usdc,
      zeroHash,
      maxFee,
      CCTP_FINALITY_FAST,
    ],
    chainId: args.baseChainId,
  });
  args.onBurn?.(burnHash);
  await waitForTransactionReceipt(wagmiConfig, {
    hash: burnHash,
    chainId: args.baseChainId,
  });

  progress("Waiting for Circle to attest - usually under a minute");
  const attested = await waitForAttestation(burnHash, {
    sourceDomain: CCTP_DOMAIN_BASE,
    network: args.network,
  });

  args.onAttested?.(attested);

  progress("Delivering on Starknet");
  const transactionHash = await deliverAttestation(args.network, attested);

  return {
    burnHash,
    transactionHash,
    deliveredAtLeast: args.amount - maxFee,
  };
}

/**
 * The last step on its own: hand Circle's attestation to the relayer, which
 * mints to the address the burn already named. Separate so a delivery that
 * failed after a successful burn can be retried without burning again.
 */
export async function deliverAttestation(
  network: AppNetwork,
  attested: { message: string; attestation: string },
): Promise<string> {
  const response = await fetch("/api/bridge/settle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      network,
      message: attested.message,
      attestation: attested.attestation,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error ?? "The transfer was not delivered");
  }
  return String(body.transactionHash ?? "");
}
