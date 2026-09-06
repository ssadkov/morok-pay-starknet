import { hash, num, validateAndParseAddress } from "starknet";
import type { Hex } from "viem";

import type { AppNetwork } from "@/lib/network";
import { commitmentFromSeed } from "@/lib/pay/escrow-v2";
import { starknetOf } from "@/lib/starknet/constants";
import { createProvider } from "@/lib/starknet/status";
import { escrowV2Status, readEscrowV2Entry } from "@/lib/starknet/escrow-v2";
import {
  ephemeralEvmAddress,
  signEphemeralClaim,
  signEphemeralOwnership,
} from "./ephemeral-claimer";
import { inspectEth712Account, OWNERSHIP_MESSAGE } from "./eth712-account";
import {
  eth712OutsideExecutionTypedData,
  packOutsideExecutionCalldata,
  type OutsideExecutionIntent,
} from "./eth712-outside-execution";
import { ethSignatureToAccountFelts } from "./eth712-transaction";
import { privacySdkOf } from "./network";

async function loadClaimable(args: {
  network: AppNetwork;
  commitment: string;
}) {
  const chain = starknetOf(args.network);
  if (!chain.escrowV2) {
    throw new Error(`MorokEscrowV2 is not deployed on ${args.network}`);
  }
  const entry = await readEscrowV2Entry(args);
  const provider = createProvider(args.network);
  const now = BigInt((await provider.getBlock("latest")).timestamp);
  const status = escrowV2Status(entry, now);
  if (status.state === "missing") throw new Error("Nothing is parked behind this link");
  if (status.state === "claimed") throw new Error("This link has already been claimed");
  const infoResponse = await fetch(`/api/escrow/claim?n=${args.network}`);
  const info = await infoResponse.json();
  if (!infoResponse.ok || !info.relayerAddress || BigInt(info.escrow) !== BigInt(chain.escrowV2)) {
    throw new Error(info.error ?? "Claim relayer is unavailable");
  }
  return { chain, provider, now, status, relayer: info.relayerAddress as string };
}

/**
 * Claim a V2 bearer link into a public ERC-20 balance at `destination`.
 * The link seed authorises; the claimer's MetaMask only picks the payout address.
 * Never send the seed to the API - only the ownership proof and signed intent.
 */
export async function claimEscrowV2(args: {
  network: AppNetwork;
  seed: Hex;
  destination: string;
}): Promise<{ transactionHash: string }> {
  const commitment = commitmentFromSeed(args.seed);
  const { chain, provider, now, status, relayer } = await loadClaimable({
    network: args.network,
    commitment,
  });
  const sdk = privacySdkOf(args.network);
  const evmAddress = ephemeralEvmAddress(args.seed);
  const owner = await inspectEth712Account(evmAddress, provider, sdk.accountFactory);
  if (BigInt(owner.starknetAddress) !== BigInt(status.entry.owner)) {
    throw new Error("This link does not control the parked entry");
  }

  const destination = validateAndParseAddress(args.destination);
  const intent = await signEphemeralClaim({
    seed: args.seed,
    starknetAddress: owner.starknetAddress,
    snChainName: sdk.snChainName,
    evmChainId: args.network === "mainnet" ? 1 : 11155111,
    caller: relayer,
    executeBefore: Number(now) + 600,
    call: {
      to: chain.escrowV2,
      selector: hash.getSelectorFromName("claim"),
      calldata: [commitment, destination],
    },
  });
  const signature = await signEphemeralOwnership(args.seed, OWNERSHIP_MESSAGE);
  const response = await fetch("/api/escrow/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      network: args.network,
      commitment,
      evmAddress,
      signature,
      calldata: intent.calldata,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.transactionHash) {
    throw new Error(payload.error ?? "Claim submission failed");
  }
  return { transactionHash: String(payload.transactionHash) };
}

/**
 * Claim an indexed invoice whose owner is the connected MetaMask account.
 * Tokens land as a public balance at `destination` (usually the same account).
 */
export async function claimEscrowV2AsOwner(args: {
  network: AppNetwork;
  commitment: string;
  destination: string;
  evmAddress: string;
  starknetAddress: string;
  signTypedData: (data: Record<string, unknown>) => Promise<Hex>;
  signMessage: (message: string) => Promise<Hex>;
}): Promise<{ transactionHash: string }> {
  const { chain, now, status, relayer } = await loadClaimable({
    network: args.network,
    commitment: args.commitment,
  });
  if (BigInt(status.entry.owner) !== BigInt(args.starknetAddress)) {
    throw new Error("This MetaMask does not own that escrow entry");
  }
  const sdk = privacySdkOf(args.network);
  const evmChainId = args.network === "mainnet" ? 1 : 11155111;
  const destination = validateAndParseAddress(args.destination);
  const intent: OutsideExecutionIntent = {
    caller: relayer,
    nonce: num.toHex(
      BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex")}`),
    ),
    executeAfter: 0,
    executeBefore: Number(now) + 600,
    calls: [
      {
        to: chain.escrowV2,
        selector: hash.getSelectorFromName("claim"),
        calldata: [args.commitment, destination],
      },
    ],
  };
  const typedData = eth712OutsideExecutionTypedData({
    accountAddress: args.starknetAddress,
    snChainName: sdk.snChainName,
    evmChainId,
    intent,
  });
  const signature = await args.signTypedData(
    typedData as unknown as Record<string, unknown>,
  );
  /* SDK Signature is string[] | SignatureType; account wants six hex felts. */
  const felts = ethSignatureToAccountFelts(signature, evmChainId) as string[];
  const calldata = packOutsideExecutionCalldata(intent, felts);
  const ownership = await args.signMessage(OWNERSHIP_MESSAGE);
  const response = await fetch("/api/escrow/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      network: args.network,
      commitment: args.commitment,
      evmAddress: args.evmAddress,
      signature: ownership,
      calldata,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.transactionHash) {
    throw new Error(payload.error ?? "Claim submission failed");
  }
  return { transactionHash: String(payload.transactionHash) };
}
