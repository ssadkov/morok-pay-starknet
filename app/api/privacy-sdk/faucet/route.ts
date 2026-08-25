import { RpcProvider } from "starknet";

import {
  readFaucetStatus,
  requestFaucetFunding,
} from "@/lib/privacy/faucet-agent";
import { inspectEth712Account } from "@/lib/privacy/eth712-account";
import {
  parseWholeStrk,
  readPublicStrkBalance,
  verifyOwnershipRequest,
} from "@/lib/privacy/onboarding-server";
import { starknetOf } from "@/lib/starknet/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MINIMUM_BALANCE = 10n * 10n ** 18n;

function provider() {
  return new RpcProvider({
    nodeUrl:
      process.env.MOROKPAY_SEPOLIA_RPC_URL ?? starknetOf("sepolia").rpc,
  });
}

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 10_000) {
      return Response.json({ error: "Request is too large" }, { status: 413 });
    }
    const ownership = await verifyOwnershipRequest(await request.json());
    const rpc = provider();
    const inspection = await inspectEth712Account(ownership.evmAddress, rpc);
    const currentBalance = await readPublicStrkBalance(
      rpc,
      inspection.starknetAddress,
    );
    const minimum = parseWholeStrk(
      process.env.MOROKPAY_SEPOLIA_MIN_DEPLOY_STRK,
      DEFAULT_MINIMUM_BALANCE,
    );
    if (currentBalance >= minimum) {
      return Response.json({
        status: "already_funded",
        starknetAddress: inspection.starknetAddress,
        balance: currentBalance.toString(),
      });
    }
    const result = await requestFaucetFunding(inspection.starknetAddress);
    return Response.json({
      status: "pending",
      starknetAddress: inspection.starknetAddress,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Faucet request failed";
    const status = /ownership|invalid onboarding/i.test(message) ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}

export async function GET(request: Request) {
  try {
    const requestId = new URL(request.url).searchParams.get("requestId") ?? "";
    return Response.json(await readFaucetStatus(requestId));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Faucet status failed",
      },
      { status: 502 },
    );
  }
}
