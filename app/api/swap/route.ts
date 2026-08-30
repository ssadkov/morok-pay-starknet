import {
  AvnuUnavailableError,
  buildSwapCalls,
  quoteSwap,
} from "@/lib/avnu/client";
import { parseAppNetwork, type AppNetwork } from "@/lib/network";
import { STRK_ADDRESS, starknetOf } from "@/lib/starknet/constants";

/**
 * A thin proxy in front of AVNU, for two reasons that both matter.
 *
 * The integrator fee is set here rather than in the page: it is what MorokPay
 * charges, and a value the browser could edit is not a fee. And a quote asked
 * for from the server is one CORS policy this app does not have to depend on.
 *
 * Nothing here signs or submits. The calls come back to the browser and the
 * user's own wallet decides whether to send them.
 */

export const maxDuration = 30;

/** Basis points MorokPay takes on a swap, paid out by AVNU to the treasury. */
function integratorFee(network: AppNetwork) {
  const bps = Number(process.env.MOROKPAY_AVNU_INTEGRATOR_FEE_BPS ?? "0");
  const recipient = starknetOf(network).treasury?.trim();
  if (!Number.isFinite(bps) || bps <= 0 || !recipient) return {};
  /* Capped rather than trusted: a fat-fingered env var should not be able to
     quietly take a fifth of somebody's swap. */
  return {
    integratorFeeBps: Math.min(Math.round(bps), 100),
    integratorFeeRecipient: recipient,
  };
}

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 10_000) {
      return Response.json({ error: "Request is too large" }, { status: 413 });
    }
    const body = await request.json();
    const network = parseAppNetwork(
      typeof body?.network === "string" ? body.network : null,
      "mainnet",
    );
    const chain = starknetOf(network);

    if (body?.action === "quote") {
      const sellAmount = BigInt(String(body.sellAmount ?? "0"));
      if (sellAmount <= BigInt(0)) {
        return Response.json({ error: "Enter an amount to swap" }, { status: 400 });
      }
      const quote = await quoteSwap({
        network,
        sellToken: chain.usdc,
        buyToken: STRK_ADDRESS,
        sellAmount,
        takerAddress:
          typeof body.takerAddress === "string" ? body.takerAddress : undefined,
      });
      return Response.json({
        ...quote,
        sellAmount: quote.sellAmount.toString(),
        buyAmount: quote.buyAmount.toString(),
        gasFees: quote.gasFees.toString(),
      });
    }

    if (body?.action === "build") {
      const quoteId = String(body.quoteId ?? "");
      const takerAddress = String(body.takerAddress ?? "");
      if (!quoteId || !/^0x[0-9a-fA-F]{1,64}$/.test(takerAddress)) {
        return Response.json({ error: "Missing quote or address" }, { status: 400 });
      }
      const slippage = Number(body.slippage ?? 0.01);
      const calls = await buildSwapCalls({
        network,
        quoteId,
        takerAddress,
        slippage: Number.isFinite(slippage) ? Math.min(Math.max(slippage, 0.001), 0.05) : 0.01,
        ...integratorFee(network),
      });
      return Response.json({ calls });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof AvnuUnavailableError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    return Response.json(
      { error: "MorokPay could not reach the swap router" },
      { status: 500 },
    );
  }
}
