import { Account, RpcProvider, validateAndParseAddress } from "starknet";

import { receiveMessageCall } from "@/lib/cctp/bytes";
import { parseAppNetwork } from "@/lib/network";
import { relayerCredentials } from "@/lib/privacy/relay-submission";
import { starknetOf } from "@/lib/starknet/constants";

/**
 * Finishes a CCTP transfer on Starknet, from MorokPay's relayer.
 *
 * Circle burns on Base and attests, but the mint does not happen by itself -
 * somebody has to call `receive_message` on Starknet and pay gas for it. Until
 * now that somebody was the user, which is impossible for the person this
 * whole path is for: they are bridging *because* they have nothing on Starknet
 * yet, least of all STRK to pay a fee with.
 *
 * So the relayer calls it. That costs us gas and nothing else - the mint goes
 * to the recipient the burn already named on Base, which this endpoint cannot
 * change and does not try to. Replaying a spent message is not a risk worth
 * guarding here either: the MessageTransmitter tracks its own nonces and
 * refuses a second one, so a duplicate call fails on chain rather than
 * double-minting.
 */

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 100_000) {
      return Response.json({ error: "Request is too large" }, { status: 413 });
    }
    const body = await request.json();
    const network = parseAppNetwork(
      typeof body?.network === "string" ? body.network : null,
      "sepolia",
    );

    const message = String(body?.message ?? "");
    const attestation = String(body?.attestation ?? "");
    if (!/^0x[0-9a-fA-F]+$/.test(message) || !/^0x[0-9a-fA-F]+$/.test(attestation)) {
      return Response.json(
        { error: "That is not a Circle message and attestation" },
        { status: 400 },
      );
    }

    const credentials = relayerCredentials(network);
    if (!credentials) {
      return Response.json(
        { error: `MorokPay ${network} relayer is not configured` },
        { status: 503 },
      );
    }

    const provider = new RpcProvider({ nodeUrl: credentials.rpc });
    const relayer = new Account({
      provider,
      address: validateAndParseAddress(credentials.address),
      signer: credentials.privateKey,
    });

    const submission = await relayer.execute(
      receiveMessageCall(message, attestation, starknetOf(network).messageTransmitter),
    );
    return Response.json({
      transactionHash: submission.transaction_hash,
      relayerAddress: relayer.address,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    /* Worth distinguishing: an already-minted message is a page that was
       refreshed, not a failure the user can act on. */
    if (/nonce|already|used/i.test(detail)) {
      return Response.json(
        { error: "This transfer has already been delivered." },
        { status: 409 },
      );
    }
    return Response.json(
      { error: "MorokPay could not deliver this transfer" },
      { status: 500 },
    );
  }
}
