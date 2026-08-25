import { Account, RpcProvider, validateAndParseAddress } from "starknet";

import {
  deployEth712AccountCall,
  eth712Strk20ClassMode,
  inspectEth712Account,
} from "@/lib/privacy/eth712-account";
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
    if (inspection.deployed) {
      return Response.json({
        status: "already_deployed",
        starknetAddress: inspection.starknetAddress,
        deployedClassHash: inspection.deployedClassHash,
      });
    }
    if (
      eth712Strk20ClassMode(inspection.configuredAccountClassHash) ===
      "unsupported"
    ) {
      return Response.json(
        { error: "The factory is configured with an unsupported account class" },
        { status: 409 },
      );
    }

    const balance = await readPublicStrkBalance(rpc, inspection.starknetAddress);
    const minimum = parseWholeStrk(
      process.env.MOROKPAY_SEPOLIA_MIN_DEPLOY_STRK,
      DEFAULT_MINIMUM_BALANCE,
    );
    if (balance < minimum) {
      return Response.json(
        {
          error: "Fund the deterministic account before deployment",
          starknetAddress: inspection.starknetAddress,
          balance: balance.toString(),
          minimum: minimum.toString(),
        },
        { status: 409 },
      );
    }

    const relayerAddress = process.env.MOROKPAY_SEPOLIA_RELAYER_ADDRESS?.trim();
    const relayerPrivateKey =
      process.env.MOROKPAY_SEPOLIA_RELAYER_PRIVATE_KEY?.trim();
    if (!relayerAddress || !relayerPrivateKey) {
      return Response.json(
        { error: "MorokPay Sepolia relayer is not configured" },
        { status: 503 },
      );
    }

    const relayer = new Account({
      provider: rpc,
      address: validateAndParseAddress(relayerAddress),
      signer: relayerPrivateKey,
    });
    const submission = await relayer.execute(
      deployEth712AccountCall({
        factoryAddress: inspection.factoryAddress,
        evmAddress: ownership.evmAddress,
        signature: ownership.signature,
      }),
    );
    return Response.json({
      status: "pending",
      starknetAddress: inspection.starknetAddress,
      relayerAddress: relayer.address,
      transactionHash: submission.transaction_hash,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Account deployment failed";
    const status = /ownership|invalid onboarding/i.test(message) ? 400 : 502;
    return Response.json(
      {
        error:
          status === 400
            ? message
            : "MorokPay could not submit the Sepolia deployment",
      },
      { status },
    );
  }
}
