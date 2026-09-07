import { Account, RpcProvider, validateAndParseAddress } from "starknet";

import { parseAppNetwork, type AppNetwork } from "@/lib/network";
import { inspectEth712Account } from "@/lib/privacy/eth712-account";
import { privacySdkOf } from "@/lib/privacy/network";
import { verifyOwnershipRequest, readPublicStrkBalance } from "@/lib/privacy/onboarding-server";
import { relayerCredentials, DEFAULT_RELAY_GAS_CAP } from "@/lib/privacy/relay-submission";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Sends a CCTP burn out of somebody else's account, and pays for it.
 *
 * The body is an `execute_from_outside_v2` calldata blob the owner already
 * signed with MetaMask. This route neither builds it nor can alter it: the
 * account verifies the EIP-712 signature over the whole struct, so a changed
 * recipient, amount or nonce fails on chain rather than here. What the route
 * decides is only whether to pay the gas.
 *
 * The account is derived from the EVM address in the ownership proof, so a
 * caller cannot ask us to sponsor a burn out of an account they do not own -
 * and even if they did, the account's own signature check would refuse it.
 */

const MAXIMUM_BODY_BYTES = 100_000;

export async function POST(request: Request) {
  let network: AppNetwork = "sepolia";
  try {
    if (Number(request.headers.get("content-length") ?? 0) > MAXIMUM_BODY_BYTES) {
      return Response.json({ error: "Request is too large" }, { status: 413 });
    }
    const body = await request.json();
    network = parseAppNetwork(
      typeof body?.network === "string" ? body.network : null,
      "sepolia",
    );

    const credentials = relayerCredentials(network);
    if (!credentials) {
      return Response.json(
        { error: `MorokPay ${network} relayer is not configured` },
        { status: 503 },
      );
    }

    const ownership = await verifyOwnershipRequest(body);
    const calldata = body?.calldata;
    if (
      !Array.isArray(calldata) ||
      calldata.length === 0 ||
      !calldata.every((felt) => typeof felt === "string" && /^0x[0-9a-fA-F]+$/.test(felt))
    ) {
      return Response.json(
        { error: "That is not an execute_from_outside_v2 calldata" },
        { status: 400 },
      );
    }

    const rpc = new RpcProvider({ nodeUrl: credentials.rpc });
    const inspection = await inspectEth712Account(
      ownership.evmAddress,
      rpc,
      privacySdkOf(network).accountFactory,
    );
    if (!inspection.deployed) {
      return Response.json(
        { error: "That account is not deployed yet" },
        { status: 409 },
      );
    }

    const relayer = new Account({
      provider: rpc,
      address: validateAndParseAddress(credentials.address),
      signer: credentials.privateKey,
    });

    /* One burn's worth of gas, and no pool fee - a CCTP burn never touches the
       pool. Refusing here beats a half-spent relayer discovering it mid-flight. */
    const balance = await readPublicStrkBalance(rpc, relayer.address);
    if (balance < DEFAULT_RELAY_GAS_CAP) {
      return Response.json(
        { error: "The relayer is below its reserve for one sponsored burn" },
        { status: 503 },
      );
    }

    const submission = await relayer.execute({
      contractAddress: validateAndParseAddress(inspection.starknetAddress),
      entrypoint: "execute_from_outside_v2",
      calldata,
    });

    return Response.json({
      status: "submitted",
      starknetAddress: inspection.starknetAddress,
      relayerAddress: relayer.address,
      transactionHash: submission.transaction_hash,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The burn could not be submitted";
    const status = /ownership|invalid onboarding/i.test(message) ? 400 : 502;
    return Response.json({ error: status === 400 ? message : relayFailure(message, network) }, { status });
  }
}

/** The client needs the relayer address to name it as the intent's caller. */
export async function GET(request: Request) {
  const network = parseAppNetwork(
    new URL(request.url).searchParams.get("network"),
    "sepolia",
  );
  const credentials = relayerCredentials(network);
  if (!credentials) {
    return Response.json(
      { error: `MorokPay ${network} relayer is not configured` },
      { status: 503 },
    );
  }
  return Response.json({ relayer: validateAndParseAddress(credentials.address) });
}

/**
 * Say what actually went wrong.
 *
 * This used to answer every failure with "could not submit the burn", which
 * cost an evening: a reverted validation, a broken RPC and a flat refusal all
 * looked identical from the outside. A revert reason is not a secret - it is
 * on chain the moment the transaction is - so the only thing worth hiding is
 * the proof-sized hex that makes the message unreadable.
 */
function relayFailure(message: string, network: AppNetwork) {
  const cleaned = message
    .replace(/0x[0-9a-f]{200,}/gi, "[large hex omitted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return `MorokPay could not submit the ${network} burn: ${cleaned}`;
}
