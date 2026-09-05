import { Account, RpcProvider, validateAndParseAddress } from "starknet";

import { parseAppNetwork, type AppNetwork } from "@/lib/network";
import {
  deployEth712AccountCall,
  inspectEth712Account,
} from "@/lib/privacy/eth712-account";
import { privacySdkOf } from "@/lib/privacy/network";
import {
  callerKey,
  chargeRelayBudget,
  type RelayWindow,
} from "@/lib/privacy/relay-limits";
import { verifyOwnershipRequest } from "@/lib/privacy/onboarding-server";
import { starknetOf } from "@/lib/starknet/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAXIMUM_BODY_BYTES = 20_000;
const FELT_RE = /^0x[0-9a-fA-F]{1,64}$/;

const budget = new Map<string, RelayWindow>();

function relayerEnv(network: AppNetwork) {
  return network === "mainnet"
    ? {
        rpc: process.env.MOROKPAY_MAINNET_RPC_URL ?? starknetOf("mainnet").rpc,
        address: process.env.MOROKPAY_MAINNET_RELAYER_ADDRESS?.trim(),
        privateKey: process.env.MOROKPAY_MAINNET_RELAYER_PRIVATE_KEY?.trim(),
      }
    : {
        rpc: process.env.MOROKPAY_SEPOLIA_RPC_URL ?? starknetOf("sepolia").rpc,
        address: process.env.MOROKPAY_SEPOLIA_RELAYER_ADDRESS?.trim(),
        privateKey: process.env.MOROKPAY_SEPOLIA_RELAYER_PRIVATE_KEY?.trim(),
      };
}

/**
 * Is there funded, unclaimed, unexpired money behind this commitment?
 *
 * Read from the escrow rather than trusted from the request. The caller picks
 * the commitment, so believing it would let anyone spend MorokPay's gas on an
 * account deploy and a relayed call for nothing. It is also the honest answer
 * to "why would you pay for a stranger's transaction": because the money is
 * already there and this is what delivering it costs.
 */
async function claimableEntry(args: {
  rpc: RpcProvider;
  escrow: string;
  commitment: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const result = await args.rpc.callContract({
      contractAddress: args.escrow,
      entrypoint: "get_entry",
      calldata: [args.commitment],
    });
    const values = Array.isArray(result)
      ? result
      : ((result as { result?: string[] }).result ?? []);
    const [token, amount, , , expiresAt, claimed] = values;
    if (!token || BigInt(token) === BigInt(0)) {
      return { ok: false, reason: "Nothing is parked behind this link" };
    }
    if (BigInt(amount ?? "0x0") === BigInt(0)) {
      return { ok: false, reason: "This entry holds nothing" };
    }
    if (BigInt(claimed ?? "0x0") !== BigInt(0)) {
      return { ok: false, reason: "This link has already been claimed" };
    }
    const expiry = BigInt(expiresAt ?? "0x0");
    if (expiry !== BigInt(0)) {
      const now = BigInt((await args.rpc.getBlock("latest")).timestamp);
      if (now >= expiry) {
        return { ok: false, reason: "This link expired and is back with the sender" };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "The escrow could not be read" };
  }
}

/**
 * Submits a claim on behalf of whoever holds the link, and pays for it.
 *
 * Two things travel here and neither is a secret: the link's public address
 * and an intent it signed. The seed itself never leaves the browser, and the
 * intent names its own destination, so this route cannot redirect the money
 * even though it is the one submitting - the account would reject a struct
 * that did not hash to the signature.
 */
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

    const commitment = typeof body?.commitment === "string" ? body.commitment : "";
    if (!FELT_RE.test(commitment)) {
      return Response.json({ error: "Invalid commitment" }, { status: 400 });
    }
    const calldata = Array.isArray(body?.calldata) ? body.calldata : null;
    if (!calldata || !calldata.every((item: unknown) => typeof item === "string" && FELT_RE.test(item))) {
      return Response.json({ error: "Invalid intent" }, { status: 400 });
    }
    /* Proves the caller holds the link's key before any gas is spent - the
       intent proves it again on chain, but failing here is free. */
    const ownership = await verifyOwnershipRequest(body);

    const chain = starknetOf(network);
    if (!chain.escrowV2) {
      return Response.json(
        { error: `MorokEscrowV2 is not deployed on ${network}` },
        { status: 409 },
      );
    }

    const env = relayerEnv(network);
    if (!env.address || !env.privateKey) {
      return Response.json(
        { error: `MorokPay ${network} relayer is not configured` },
        { status: 503 },
      );
    }

    const verdict = chargeRelayBudget({
      store: budget,
      caller: callerKey(request.headers),
      now: Date.now(),
    });
    if (!verdict.allowed) {
      return Response.json(
        {
          error:
            verdict.scope === "caller"
              ? "Too many claims from here. Try again shortly."
              : "MorokPay is relaying too much right now. Try again shortly.",
          retryAfterSeconds: verdict.retryAfterSeconds,
        },
        { status: 429, headers: { "retry-after": String(verdict.retryAfterSeconds) } },
      );
    }

    const rpc = new RpcProvider({ nodeUrl: env.rpc });
    const parked = await claimableEntry({ rpc, escrow: chain.escrowV2, commitment });
    if (!parked.ok) {
      return Response.json({ error: parked.reason }, { status: 409 });
    }

    const factoryAddress = privacySdkOf(network).accountFactory;
    const inspection = await inspectEth712Account(
      ownership.evmAddress,
      rpc,
      factoryAddress,
    );

    /* A link's account has never been used, so the first claim through it is
       also its deployment. Both go in one transaction: the account has to
       exist before it can execute anything. */
    const calls = [];
    if (!inspection.deployed) {
      calls.push(
        deployEth712AccountCall({
          factoryAddress: inspection.factoryAddress,
          evmAddress: ownership.evmAddress,
          signature: ownership.signature,
        }),
      );
    }
    calls.push({
      contractAddress: validateAndParseAddress(inspection.starknetAddress),
      entrypoint: "execute_from_outside_v2",
      calldata,
    });

    const relayer = new Account({
      provider: rpc,
      address: validateAndParseAddress(env.address),
      signer: env.privateKey,
    });
    const submission = await relayer.execute(calls);
    return Response.json({
      status: "submitted",
      transactionHash: String(submission.transaction_hash),
      starknetAddress: inspection.starknetAddress,
      deployed: inspection.deployed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claim failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
