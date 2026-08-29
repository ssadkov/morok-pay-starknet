import { parseAppNetwork, type AppNetwork } from "@/lib/network";
import {
  callerKey,
  chargeRelayBudget,
  type RelayWindow,
} from "@/lib/privacy/relay-limits";
import {
  parseRelayRequest,
  relayEnabled,
  relayerCredentials,
  RelayRejected,
  submitRelayed,
} from "@/lib/privacy/relay-submission";
import { readPoolFee } from "@/lib/starknet/pool-fee";

export const runtime = "nodejs";
export const maxDuration = 60;

/* A proof is hundreds of kilobytes, so this route cannot use the 10 KB body
   cap the other privacy routes do. */
const MAXIMUM_BODY_BYTES = 5_000_000;

const budget = new Map<string, RelayWindow>();

/**
 * Submits a donor's proven `apply_actions` from MorokPay's relayer.
 *
 * The donor builds and authorizes the action set in their own browser; this
 * route only pays for it and sends it. Nothing in the request names the donor,
 * and nothing here writes the payload anywhere - what MorokPay learns is an IP
 * and a timestamp, and only for as long as the platform's own request log
 * keeps them.
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

    if (!relayEnabled(network)) {
      return Response.json(
        {
          error: `MorokPay does not relay on ${network} yet. Submitting this donation yourself would publish your address next to the recipient's.`,
        },
        { status: 503 },
      );
    }

    const relayRequest = parseRelayRequest(body, network);

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
              ? "This address has used its relay allowance for now."
              : "MorokPay's relay allowance for this hour is spent.",
          retryAfterSeconds: verdict.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "retry-after": String(verdict.retryAfterSeconds) },
        },
      );
    }

    const credentials = relayerCredentials(network);
    if (!credentials) {
      return Response.json(
        { error: `MorokPay ${network} relayer is not configured` },
        { status: 503 },
      );
    }

    const result = await submitRelayed({
      network,
      request: relayRequest,
      credentials,
      poolFee: await readPoolFee(network),
    });
    return Response.json({ status: "submitted", ...result });
  } catch (error) {
    if (error instanceof RelayRejected) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    /* Never echo the chain's error back: it can quote the calldata, which is
       the one thing this route is meant not to spread around. */
    console.error("relay submission failed", {
      network,
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      { error: `MorokPay could not submit this ${network} donation` },
      { status: 502 },
    );
  }
}
