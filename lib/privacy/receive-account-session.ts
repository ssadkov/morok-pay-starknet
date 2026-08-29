import { RpcProvider, ec, num, validateAndParseAddress } from "starknet";
import type { Hex } from "viem";
import {
  createPrivateTransfers,
  type Note,
} from "@starkware-libs/starknet-privacy-sdk";
import { deriveViewingKey } from "@starkware-libs/starknet-privacy-client";
import { Snip12CallSetSigner } from "@starkware-libs/starknet-privacy-client/signers";

import type { AppNetwork } from "@/lib/network";
import { privacySdkOf } from "@/lib/privacy/network";
import {
  namesRecipient,
  normalizeCall,
  relaySubmission,
} from "@/lib/privacy/relay-client";
import { deriveReceiveAccount } from "@/lib/privacy/receive-account";

/**
 * Acting as the account a QR publishes.
 *
 * `B` holds a STARK key, so it authorizes the pool the plain way - a SNIP-12
 * CallSet signature the pool checks against the account's own
 * `is_valid_signature`. No wallet prompt is involved: the key came from one
 * signature by `A` and lives in memory for as long as the page does.
 *
 * Everything `B` does is relayed, without the per-transaction test the donor
 * rail uses. That is not caution, it is arithmetic: `B` is deliberately never
 * funded, so it cannot pay a fee, and the moment anyone tops it up the account
 * that did is tied to the QR forever.
 */

const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = BigInt("0x50524f4f4631");

export type ReceiveAccountSession = {
  address: string;
  provider: RpcProvider;
  /** Shielded balance per token, in that token's smallest unit. */
  balances(tokens: string[]): Promise<{ token: string; balance: string }[]>;
  /** Publishes `B`'s viewing key, so donations can be encrypted to it. */
  register(): Promise<{ transaction_hash: string }>;
  /** Moves everything worth moving to the creator's main account. */
  sweep(args: {
    token: string;
    amount: bigint;
    to: string;
  }): Promise<{ transaction_hash: string }>;
};

export function createReceiveAccountSession(args: {
  signature: Hex;
  network: AppNetwork;
}): ReceiveAccountSession {
  const sdk = privacySdkOf(args.network);
  const receive = deriveReceiveAccount(args.signature);
  const provider = new RpcProvider({
    nodeUrl: sdk.privacyRpcUrl,
    specVersion: "0.10.3",
  });

  const transfers = createPrivateTransfers({
    account: {
      address: receive.address,
      signer: new Snip12CallSetSigner({
        accountAddress: receive.address,
        chainId: sdk.starknetChainId,
        sign: (messageHash) =>
          ec.starkCurve.sign(num.toHex(messageHash), receive.privateKey),
      }),
    },
    viewingKeyProvider: {
      /* The same signature that made the key makes the viewing key, so a
         creator opening this page on another device sees the same balance. */
      getViewingKey: async () =>
        BigInt(deriveViewingKey(args.signature, receive.address)),
    },
    provingProvider: {
      url: sdk.proverUrl,
      chainId: sdk.starknetChainId,
      nodeUrl: sdk.privacyRpcUrl,
      ohttp: true,
    },
    discoveryProvider: { url: sdk.discoveryUrl },
    poolContractAddress: sdk.poolAddress,
  });

  async function provingBlock() {
    return (await provider.getBlockNumber()) - PROVING_BLOCK_DEPTH;
  }

  async function relayProven(builder: {
    createProofInvocation(options: {
      provingBlockId: number;
    }): Promise<Parameters<typeof transfers.executeWithInvocation>[0]>;
  }) {
    const block = await provingBlock();
    const invocation = await builder.createProofInvocation({
      provingBlockId: block,
    });
    const result = await transfers.executeWithInvocation(invocation, block);
    const { call, proof } = result.callAndProof;
    if (
      !proof.proofFacts.length ||
      BigInt(proof.proofFacts[0]) !== PROOF1_VERSION
    ) {
      throw new Error("The prover returned unsupported proof facts.");
    }
    return relaySubmission({
      network: args.network,
      call: normalizeCall(call as Parameters<typeof normalizeCall>[0]),
      proof: proof.data,
      proofFacts: proof.proofFacts.map(String),
    });
  }

  return {
    address: receive.address,
    provider,

    async balances(tokens) {
      const discovered = await transfers.discoverNotes({
        tokens: tokens.map(BigInt),
      });
      return tokens.map((token) => ({
        token,
        balance: (discovered.notes.get(BigInt(token)) ?? [])
          .reduce((sum, note) => sum + note.amount, BigInt(0))
          .toString(),
      }));
    },

    async register() {
      return relayProven(transfers.build().register());
    },

    async sweep({ token, amount, to }) {
      const destination = validateAndParseAddress(to);
      const block = await provingBlock();
      const discovered = await transfers.discoverNotes({
        tokens: [BigInt(token)],
        blockIdentifier: block,
      });
      const notes = [...(discovered.notes.get(BigInt(token)) ?? [])].sort(
        (left, right) =>
          left.amount < right.amount ? -1 : left.amount > right.amount ? 1 : 0,
      );
      const inputs: Note[] = [];
      let total = BigInt(0);
      for (const note of notes) {
        inputs.push(note);
        total += note.amount;
        if (total >= amount) break;
      }
      if (total < amount) {
        throw new Error(
          `Proving block ${block} sees ${total} of the ${amount} this sweep needs. A donation that just landed is not spendable until it is about ${PROVING_BLOCK_DEPTH} blocks old.`,
        );
      }

      const builder = transfers
        .build({ autoSetup: true })
        .with(token, (operations) => {
          operations.inputs(...inputs);
          operations.transfer({ recipient: destination, amount });
        })
        .surplusTo(receive.address);

      const invocation = await builder.createProofInvocation({
        provingBlockId: block,
      });
      const result = await transfers.executeWithInvocation(invocation, block);
      const { call, proof } = result.callAndProof;
      if (
        !proof.proofFacts.length ||
        BigInt(proof.proofFacts[0]) !== PROOF1_VERSION
      ) {
        throw new Error("The prover returned unsupported proof facts.");
      }
      const relayable = normalizeCall(
        call as Parameters<typeof normalizeCall>[0],
      );
      /* The sweep opens a channel to the main account the first time, so that
         address does appear in this calldata - unavoidable, and it is the
         creator's own disclosure to make. What must never appear beside it is
         `B`, and `B` is spent through nullifiers, so it does not. Relaying
         keeps `B` out of the sender field too, which is the other half. */
      if (namesRecipient(relayable, receive.address)) {
        throw new Error(
          "This sweep would publish the QR's account next to your main one. Nothing was submitted.",
        );
      }
      return relaySubmission({
        network: args.network,
        call: relayable,
        proof: proof.data,
        proofFacts: proof.proofFacts.map(String),
      });
    },
  };
}
