import { Account, RpcProvider, validateAndParseAddress } from "starknet";

import { parseAppNetwork, type AppNetwork } from "@/lib/network";
import {
  deployEth712AccountCall,
  eth712Strk20ClassMode,
  inspectEth712Account,
} from "@/lib/privacy/eth712-account";
import { privacySdkOf } from "@/lib/privacy/network";
import {
  parseWholeStrk,
  readPublicStrkBalance,
  sponsoredTopUpAmount,
  verifyOwnershipRequest,
} from "@/lib/privacy/onboarding-server";
import { publicStrkTransferCall } from "@/lib/starknet/actions";
import { starknetOf } from "@/lib/starknet/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_SPONSORED_BALANCE = 20n * 10n ** 18n;
/**
 * Mainnet never sponsors a balance - the connecting account must already hold
 * public STRK. This is only a courtesy check so a deploy doesn't succeed into
 * an account that visibly cannot afford the registration step right after it.
 */
const DEFAULT_MAINNET_MIN_DEPLOY_STRK = 15n * 10n ** 18n;

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
    const ownership = await verifyOwnershipRequest(body);

    const env = relayerEnv(network);
    const rpc = new RpcProvider({ nodeUrl: env.rpc });
    const factoryAddress = privacySdkOf(network).accountFactory;
    const inspection = await inspectEth712Account(
      ownership.evmAddress,
      rpc,
      factoryAddress,
    );
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

    if (!env.address || !env.privateKey) {
      return Response.json(
        { error: `MorokPay ${network} relayer is not configured` },
        { status: 503 },
      );
    }
    const relayer = new Account({
      provider: rpc,
      address: validateAndParseAddress(env.address),
      signer: env.privateKey,
    });
    const deploymentCall = deployEth712AccountCall({
      factoryAddress: inspection.factoryAddress,
      evmAddress: ownership.evmAddress,
      signature: ownership.signature,
    });

    let calls = [deploymentCall];
    let sponsoredAmount = 0n;
    let sponsoredBalance = 0n;

    if (network === "sepolia") {
      const balance = await readPublicStrkBalance(rpc, inspection.starknetAddress);
      sponsoredBalance = parseWholeStrk(
        process.env.MOROKPAY_SEPOLIA_SPONSORED_STRK,
        DEFAULT_SPONSORED_BALANCE,
      );
      sponsoredAmount = sponsoredTopUpAmount(balance, sponsoredBalance);
      if (sponsoredAmount > 0n) {
        calls = [
          publicStrkTransferCall(inspection.starknetAddress, sponsoredAmount),
          deploymentCall,
        ];
      }
    } else {
      // Mainnet: self-funded only. The relayer pays its own gas for the
      // factory call and never transfers STRK to the connecting account.
      const balance = await readPublicStrkBalance(rpc, inspection.starknetAddress);
      const minimum = parseWholeStrk(
        process.env.MOROKPAY_MAINNET_MIN_DEPLOY_STRK,
        DEFAULT_MAINNET_MIN_DEPLOY_STRK,
      );
      if (balance < minimum) {
        return Response.json(
          {
            error: `Fund ${inspection.starknetAddress} with at least ${(Number(minimum) / 1e18).toFixed(0)} public STRK before deploying. MorokPay does not sponsor mainnet accounts.`,
          },
          { status: 409 },
        );
      }
    }

    const submission = await relayer.execute(calls);
    return Response.json({
      status: "pending",
      starknetAddress: inspection.starknetAddress,
      relayerAddress: relayer.address,
      sponsoredAmount: sponsoredAmount.toString(),
      sponsoredBalance: sponsoredBalance.toString(),
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
            : `MorokPay could not submit the ${network} deployment`,
      },
      { status },
    );
  }
}
