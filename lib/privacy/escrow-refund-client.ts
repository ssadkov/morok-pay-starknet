import { hash } from "starknet";
import { isAddress, getAddress, type Hex } from "viem";

import type { AppNetwork } from "@/lib/network";
import {
  commitmentFromSalt,
  commitmentFromSeed,
  randomSalt,
  randomSeed,
} from "@/lib/pay/escrow-v2";
import { starknetOf } from "@/lib/starknet/constants";
import { createProvider } from "@/lib/starknet/status";
import { readEscrowV2Entry } from "@/lib/starknet/escrow-v2";
import { submitEscrowPrivateActions } from "@/lib/starknet/actions";
import { ephemeralEvmAddress, signEphemeralClaim, signEphemeralOwnership } from "./ephemeral-claimer";
import { inspectEth712Account, OWNERSHIP_MESSAGE } from "./eth712-account";
import { OPEN_NOTE_ID, type Strk20Action } from "./evm-strk20-account";
import { privacySdkOf } from "./network";
import { refundNoteFromCalldata } from "./escrow-refund-proof";

/** Save refundSeed privately before depositing. Share only claimSeed.
 * The refund key is independently random: a recipient holding the claim link
 * must never be able to derive it, including after the link expires.
 */
export async function createEscrowV2Keys(network: AppNetwork) {
  const claimSeed = randomSeed();
  let refundSeed = randomSeed();
  while (refundSeed === claimSeed) refundSeed = randomSeed();
  const provider = createProvider(network);
  const factory = privacySdkOf(network).accountFactory;
  const [owner, refundOwner] = await Promise.all([
    inspectEth712Account(ephemeralEvmAddress(claimSeed), provider, factory),
    inspectEth712Account(ephemeralEvmAddress(refundSeed), provider, factory),
  ]);
  return {
    claimSeed, refundSeed, commitment: commitmentFromSeed(claimSeed),
    owner: owner.starknetAddress, refundOwner: refundOwner.starknetAddress,
  };
}

/**
 * Invoice to a MetaMask address: owner is the recipient's Eth712 account,
 * indexed so they find it without a seed link. Recovery stays sender-only.
 */
export async function createEscrowV2Invoice(network: AppNetwork, recipientEvm: string) {
  if (!isAddress(recipientEvm)) throw new Error("Enter a valid MetaMask (EVM) address");
  const normalized = getAddress(recipientEvm) as Hex;
  const refundSeed = randomSeed();
  const salt = randomSalt();
  const provider = createProvider(network);
  const factory = privacySdkOf(network).accountFactory;
  const [owner, refundOwner] = await Promise.all([
    inspectEth712Account(normalized, provider, factory),
    inspectEth712Account(ephemeralEvmAddress(refundSeed), provider, factory),
  ]);
  if (BigInt(owner.starknetAddress) === BigInt(refundOwner.starknetAddress)) {
    throw new Error("Recipient and recovery accounts collided; try again");
  }
  return {
    recipientEvm: normalized,
    refundSeed,
    salt,
    commitment: commitmentFromSalt(salt),
    owner: owner.starknetAddress,
    refundOwner: refundOwner.starknetAddress,
    indexed: true as const,
  };
}

export async function refundEscrowV2Privately(args: {
  account: Parameters<typeof submitEscrowPrivateActions>[0];
  network: AppNetwork;
  senderAddress: string;
  commitment: string;
  refundSeed: Hex;
}): Promise<{ transaction_hash: string }> {
  const chain = starknetOf(args.network);
  if (!chain.escrowV2SupportsPrivateRefund || !chain.escrowV2) {
    throw new Error("The private-refund escrow revision is not deployed");
  }
  const entry = await readEscrowV2Entry(args);
  if (!entry || entry.claimed) throw new Error("This escrow is unavailable");
  const provider = createProvider(args.network);
  const sdk = privacySdkOf(args.network);
  const evmAddress = ephemeralEvmAddress(args.refundSeed);
  const recovery = await inspectEth712Account(evmAddress, provider, sdk.accountFactory);
  if (BigInt(recovery.starknetAddress) !== BigInt(entry.refundOwner) ||
      BigInt(entry.refundOwner) === BigInt(args.senderAddress)) {
    throw new Error("A separate recovery key for this escrow is required");
  }
  const now = BigInt((await provider.getBlock("latest")).timestamp);
  if (entry.expiresAt === 0n || now < entry.expiresAt) throw new Error("This escrow has not expired");
  const infoResponse = await fetch(`/api/escrow/refund?n=${args.network}`);
  const info = await infoResponse.json();
  if (!infoResponse.ok || !info.relayerAddress || BigInt(info.escrow) !== BigInt(chain.escrowV2)) {
    throw new Error(info.error ?? "Private refund relayer is unavailable");
  }
  const actions: Strk20Action[] = [
    { type: "transfer", token: entry.token, amount: "OPEN", recipient: args.senderAddress },
    { type: "invoke", contract: chain.escrowV2,
      calldata: ["0x1", OPEN_NOTE_ID, args.commitment, "0x0", "0x0", "0x0", "0x0", "0x0", "0x0"] },
  ];
  return submitEscrowPrivateActions(args.account, actions, args.senderAddress, async (prepared) => {
    const noteId = refundNoteFromCalldata({
      calldata: prepared.call.calldata, escrow: chain.escrowV2,
      commitment: args.commitment, token: entry.token,
    });
    const timestamp = (await provider.getBlock("latest")).timestamp;
    const intent = await signEphemeralClaim({
      seed: args.refundSeed, starknetAddress: recovery.starknetAddress,
      snChainName: sdk.snChainName, evmChainId: args.network === "mainnet" ? 1 : 11155111,
      caller: info.relayerAddress, executeBefore: timestamp + 600,
      call: { to: chain.escrowV2, selector: hash.getSelectorFromName("authorize_refund"),
        calldata: [args.commitment, noteId] },
    });
    const signature = await signEphemeralOwnership(args.refundSeed, OWNERSHIP_MESSAGE);
    const response = await fetch("/api/escrow/refund", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ network: args.network, commitment: args.commitment,
        evmAddress, signature, calldata: intent.calldata, refundProof: prepared }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.transactionHash) throw new Error(payload.error ?? "Refund submission failed");
    return { transaction_hash: payload.transactionHash };
  });
}
