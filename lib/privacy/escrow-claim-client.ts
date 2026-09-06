import { hash, validateAndParseAddress } from "starknet";
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
import { privacySdkOf } from "./network";

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
  const chain = starknetOf(args.network);
  if (!chain.escrowV2) {
    throw new Error(`MorokEscrowV2 is not deployed on ${args.network}`);
  }
  const commitment = commitmentFromSeed(args.seed);
  const entry = await readEscrowV2Entry({ network: args.network, commitment });
  const provider = createProvider(args.network);
  const now = BigInt((await provider.getBlock("latest")).timestamp);
  const status = escrowV2Status(entry, now);
  if (status.state === "missing") throw new Error("Nothing is parked behind this link");
  if (status.state === "claimed") throw new Error("This link has already been claimed");
  if (status.state === "expired") {
    throw new Error("This link expired and is back with the sender");
  }

  const infoResponse = await fetch(`/api/escrow/claim?n=${args.network}`);
  const info = await infoResponse.json();
  if (!infoResponse.ok || !info.relayerAddress || BigInt(info.escrow) !== BigInt(chain.escrowV2)) {
    throw new Error(info.error ?? "Claim relayer is unavailable");
  }

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
    caller: info.relayerAddress,
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
