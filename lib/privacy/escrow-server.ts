import { Account, RpcProvider, cairo, validateAndParseAddress } from "starknet";

import type { AppNetwork } from "@/lib/network";
import {
  deployEth712AccountCall,
  inspectEth712Account,
  eth712Strk20ClassMode,
} from "@/lib/privacy/eth712-account";
import { escrowClaimFelt, verifyEscrowClaimIntent } from "@/lib/privacy/escrow-claim-intent";
import { eth712FundedResourceBounds } from "@/lib/privacy/eth712-transaction";
import { DEFAULT_RELAY_GAS_CAP, parseRelayRequest, relayEnabled } from "@/lib/privacy/relay-submission";
import { refundNoteFromCalldata } from "./escrow-refund-proof";
import { privacySdkOf } from "@/lib/privacy/network";
import {
  callerKey,
  chargeRelayBudget,
  type RelayWindow,
} from "@/lib/privacy/relay-limits";
import { readPublicStrkBalance, verifyOwnershipRequest } from "@/lib/privacy/onboarding-server";
import { starknetOf, STRK_ADDRESS } from "@/lib/starknet/constants";

type Operation = "claim" | "refund";

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

export function escrowRelayInfo(request: Request, operation: Operation) {
  const network = new URL(request.url).searchParams.get("n");
  if (network !== "mainnet" && network !== "sepolia") {
    return Response.json({ error: "Invalid network" }, { status: 400 });
  }
  const env = relayerEnv(network);
  const chain = starknetOf(network);
  if (!relayEnabled(network) || !env.address || !env.privateKey) {
    return Response.json({ error: "Escrow relayer is unavailable" }, { status: 503 });
  }
  if (!chain.escrowV2 || (operation === "refund" && !chain.escrowV2SupportsPrivateRefund)) {
    return Response.json({ error: "This escrow revision is not deployed" }, { status: 409 });
  }
  return Response.json({ relayerAddress: env.address, escrow: chain.escrowV2 }, {
    headers: { "cache-control": "no-store" },
  });
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
  network: AppNetwork;
  operation: Operation;
}): Promise<{ ok: true; owner: string; token: string; now: bigint } | { ok: false; reason: string }> {
  try {
    const result = await args.rpc.callContract({
      contractAddress: args.escrow,
      entrypoint: "get_entry",
      calldata: [args.commitment],
    });
    const values = Array.isArray(result)
      ? result
      : ((result as { result?: string[] }).result ?? []);
    if (values.length !== 6) throw new Error("Unexpected escrow ABI");
    const [token, amount, owner, refundOwner, expiresAt, claimed] = values;
    if (!token || BigInt(token) === BigInt(0)) {
      return { ok: false, reason: "Nothing is parked behind this link" };
    }
    const minimum = BigInt(token) === BigInt(starknetOf(args.network).usdc)
      ? 1_000_000n : BigInt(token) === BigInt(STRK_ADDRESS) ? 5n * 10n ** 18n : null;
    if (minimum === null || BigInt(amount) < minimum) {
      return { ok: false, reason: "This token or amount is not eligible for sponsorship" };
    }
    if (BigInt(claimed ?? "0x0") !== BigInt(0)) {
      return { ok: false, reason: "This link has already been claimed" };
    }
    const expiry = BigInt(expiresAt ?? "0x0");
    const now = BigInt((await args.rpc.getBlock("latest")).timestamp);
    if (args.operation === "refund") {
      if (expiry === 0n || now < expiry) return { ok: false, reason: "This entry is not refundable yet" };
    } else if (expiry !== BigInt(0)) {
      if (now >= expiry) {
        return { ok: false, reason: "This link expired; a refund must be requested separately" };
      }
    }
    return { ok: true, owner: args.operation === "claim" ? owner : refundOwner, token, now };
  } catch {
    return { ok: false, reason: "The escrow could not be read" };
  }
}

/**
 * Submits a claim on behalf of whoever holds the link, and pays for it.
 *
 * Two things travel here and neither is a secret: the link's public address
 * and an intent it signed. This endpoint does not request the seed, and the
 * intent names its own destination, so this route cannot redirect the money
 * even though it is the one submitting - the account would reject a struct
 * that did not hash to the signature.
 */
export async function handleEscrowRequest(request: Request, operation: Operation) {
  let network: AppNetwork = "sepolia";
  const maximumBodyBytes = operation === "claim" ? 20_000 : 4_300_000;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > maximumBodyBytes) {
      return Response.json({ error: "Request is too large" }, { status: 413 });
    }
    // Count actual bytes, including streamed requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing request body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBodyBytes) {
        await reader.cancel();
        return Response.json({ error: "Request is too large" }, { status: 413 });
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body?.network !== "mainnet" && body?.network !== "sepolia") {
      throw new Error("Invalid claim network");
    }
    network = body.network;
    if (!relayEnabled(network)) {
      return Response.json({ error: `MorokPay ${network} relaying is disabled` }, { status: 503 });
    }
    const commitment = escrowClaimFelt(body.commitment);
    if (BigInt(commitment) === 0n) throw new Error("Invalid commitment");
    /* Proves the caller holds the link's key before any gas is spent - the
       intent proves it again on chain, but failing here is free. */
    const ownership = await verifyOwnershipRequest(body);

    const chain = starknetOf(network);
    if (operation === "refund" && !chain.escrowV2SupportsPrivateRefund) {
      return Response.json({ error: "The private-refund escrow revision is not deployed" }, { status: 409 });
    }
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

    const rpc = new RpcProvider({
      nodeUrl: operation === "refund"
        ? (network === "mainnet" ? process.env.MOROKPAY_MAINNET_RPC_URL : process.env.MOROKPAY_SEPOLIA_RPC_URL) ?? privacySdkOf(network).privacyRpcUrl
        : env.rpc,
      ...(operation === "refund" ? { specVersion: "0.10.3" as const } : {}),
    });
    const parked = await claimableEntry({ rpc, escrow: chain.escrowV2, commitment, network, operation });
    if (!parked.ok) {
      return Response.json({ error: parked.reason }, { status: 409 });
    }

    const factoryAddress = privacySdkOf(network).accountFactory;
    const inspection = await inspectEth712Account(
      ownership.evmAddress,
      rpc,
      factoryAddress,
    );
    if (BigInt(inspection.starknetAddress) !== BigInt(parked.owner)) {
      throw new Error("The signing account does not own this escrow entry");
    }
    const accountClass = inspection.deployed
      ? inspection.deployedClassHash : inspection.configuredAccountClassHash;
    if (!accountClass || eth712Strk20ClassMode(accountClass) === "unsupported") {
      throw new Error("Unsupported escrow owner account class");
    }
    const refund = operation === "refund" ? parseRelayRequest(body.refundProof, network) : null;
    const refundNote = refund ? refundNoteFromCalldata({
      calldata: refund.call.calldata, escrow: chain.escrowV2, commitment, token: parked.token,
    }) : undefined;
    const calldata = await verifyEscrowClaimIntent({
      calldata: body.calldata, network, escrow: chain.escrowV2, commitment,
      accountAddress: inspection.starknetAddress, evmAddress: ownership.evmAddress,
      relayer: env.address, now: parked.now, refundNote,
    });

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

    let poolFee = 0n;
    if (refund) {
      const [rawFee] = await rpc.callContract({ contractAddress: chain.pool, entrypoint: "get_fee_amount", calldata: [] });
      poolFee = BigInt(rawFee);
      // Bound protocol fee too; governance changes require a deliberate review.
      if (poolFee < 0n || poolFee > 12n * 10n ** 18n) throw new Error("Pool fee exceeds the refund sponsorship cap");
      const fee = cairo.uint256(poolFee);
      calls.push({ contractAddress: STRK_ADDRESS, entrypoint: "approve", calldata: [chain.pool, String(fee.low), String(fee.high)] });
      calls.push(refund.call);
    }

    const relayer = new Account({
      provider: rpc,
      address: validateAndParseAddress(env.address),
      signer: env.privateKey,
    });
    const balance = await readPublicStrkBalance(rpc, relayer.address);
    if (balance < DEFAULT_RELAY_GAS_CAP + poolFee) {
      throw new Error("Relayer balance is below the reserve for one sponsored claim");
    }
    const nonce = BigInt(await relayer.getNonce());
    const proofDetails = refund ? { proof: refund.proof, proofFacts: refund.proofFacts } : {};
    const estimate = await relayer.estimateInvokeFee(calls, { nonce, tip: 0n, ...proofDetails });
    const resourceBounds = eth712FundedResourceBounds({
      estimated: estimate.resourceBounds, publicBalance: balance,
      transferAmount: poolFee, maximumFeeCap: DEFAULT_RELAY_GAS_CAP,
    });
    const submission = await relayer.execute(calls, { nonce, tip: 0n, resourceBounds, ...proofDetails });
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
