import { Account, RpcProvider, num, validateAndParseAddress } from "starknet";

import { parseAppNetwork, type AppNetwork } from "@/lib/network";
import { verifyOwnershipRequest } from "@/lib/privacy/onboarding-server";
import {
  callerKey,
  chargeRelayBudget,
  type RelayWindow,
} from "@/lib/privacy/relay-limits";
import { relayEnabled, relayerCredentials } from "@/lib/privacy/relay-submission";
import {
  receiveAccountAddress,
  receiveAccountDeployCall,
} from "@/lib/privacy/receive-account";

export const runtime = "nodejs";
export const maxDuration = 60;

const budget = new Map<string, RelayWindow>();

/**
 * Deploys the account a creator's QR will publish.
 *
 * MorokPay pays, and that is the whole point. The obvious alternative - the
 * creator's main account sending the new one enough STRK to deploy itself -
 * writes `A -> B` into a public transaction and undoes the separation before
 * the QR is even printed.
 *
 * The request carries a public key, not a signature over it, so this route
 * cannot check that the key really came from the connected wallet. What it
 * checks is that the caller owns the EVM address they claim, and it charges
 * that claim against the same allowance the relay uses - so the worst a
 * dishonest caller gets is a few deployments of accounts nobody can spend
 * from.
 */
export async function POST(request: Request) {
  let network: AppNetwork = "sepolia";
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 10_000) {
      return Response.json({ error: "Request is too large" }, { status: 413 });
    }
    const body = await request.json();
    network = parseAppNetwork(
      typeof body?.network === "string" ? body.network : null,
      "sepolia",
    );
    if (!relayEnabled(network)) {
      return Response.json(
        {
          error: `MorokPay does not run receive accounts on ${network} yet. Deploying one from your own account would publish the link between them.`,
        },
        { status: 503 },
      );
    }

    const publicKey = body?.publicKey;
    if (typeof publicKey !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(publicKey)) {
      return Response.json(
        { error: "That is not a Starknet public key" },
        { status: 400 },
      );
    }
    /* Proves the caller controls the wallet, without telling us anything the
       app does not already know about them. */
    await verifyOwnershipRequest(body);

    const credentials = relayerCredentials(network);
    if (!credentials) {
      return Response.json(
        { error: `MorokPay ${network} relayer is not configured` },
        { status: 503 },
      );
    }
    const provider = new RpcProvider({ nodeUrl: credentials.rpc });
    const address = receiveAccountAddress(publicKey);

    /* Idempotent on purpose: the creator may open this page from a second
       device, or after clearing storage, and re-deriving the same account
       must not cost a second deployment. */
    try {
      await provider.getClassHashAt(address);
      return Response.json({ status: "already_deployed", address });
    } catch {
      // Not deployed yet.
    }

    const verdict = chargeRelayBudget({
      store: budget,
      caller: callerKey(request.headers),
      now: Date.now(),
    });
    if (!verdict.allowed) {
      return Response.json(
        {
          error: "This address has used its allowance for now.",
          retryAfterSeconds: verdict.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "retry-after": String(verdict.retryAfterSeconds) },
        },
      );
    }

    const relayer = new Account({
      provider,
      address: validateAndParseAddress(credentials.address),
      signer: credentials.privateKey,
    });
    const submission = await relayer.execute(
      receiveAccountDeployCall(num.toHex(BigInt(publicKey))),
    );
    return Response.json({
      status: "pending",
      address,
      transactionHash: String(submission.transaction_hash),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Receive account setup failed";
    if (/ownership|invalid onboarding/i.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    console.error("receive account deployment failed", { network });
    return Response.json(
      { error: `MorokPay could not deploy a ${network} receive account` },
      { status: 502 },
    );
  }
}
