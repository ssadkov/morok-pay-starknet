import { hash, num, validateAndParseAddress } from "starknet";
import { isAddress, type Hex } from "viem";

import { approveUsdcCall, depositForBurnCall, evmAddressToBytes32 } from "@/lib/cctp/bytes";
import type { AppNetwork } from "@/lib/network";
import {
  eth712OutsideExecutionTypedData,
  packOutsideExecutionCalldata,
  type OutsideExecutionIntent,
} from "@/lib/privacy/eth712-outside-execution";
import { ethSignatureToAccountFelts } from "@/lib/privacy/eth712-transaction";
import { OWNERSHIP_MESSAGE } from "@/lib/privacy/eth712-account";
import { privacySdkOf } from "@/lib/privacy/network";
import { starknetOf } from "@/lib/starknet/constants";

/**
 * Bridging out to Base without holding STRK.
 *
 * The account pays for its own burn everywhere else in this app, which is a
 * problem exactly where this path is useful: somebody who just unshielded
 * their last USDC has no STRK left to send it anywhere with. Circle does not
 * help - Fast Transfer buys a faster attestation, not a delivery, so a burn
 * still costs gas on Starknet and a mint still costs gas on Base.
 *
 * So the burn goes out as an outside execution: the owner signs the intent
 * with MetaMask, the relayer submits it and pays. `get_caller_address()` inside
 * the calls is still the owner's account, which matters here more than usual -
 * `deposit_for_burn` burns from the caller, so a relayer that merely sent its
 * own transaction would be bridging its own USDC, not theirs.
 *
 * The Base side stays the user's. Minting there needs ETH on Base, and a
 * recipient who is being paid in USDC on an EVM chain is a wallet holder
 * already; paying their gas would be taking over the wallet's job.
 */

/** Circle charges its fee out of the bridged USDC, so a floor keeps the burn worth doing. */
const MINIMUM_BURN = BigInt(100_000); // 0.1 USDC

export async function relayedBurnToBase(args: {
  network: AppNetwork;
  /** The Starknet account that holds the USDC and signs the intent. */
  starknetAddress: string;
  evmAddress: string;
  evmChainId: number;
  /** Where the USDC should land on Base. */
  recipient: string;
  amount: bigint;
  signTypedData: (data: Record<string, unknown>) => Promise<Hex>;
  signMessage: (message: string) => Promise<Hex>;
  onProgress?: (step: string) => void;
}): Promise<{ transactionHash: string }> {
  const progress = args.onProgress ?? (() => {});
  if (!isAddress(args.recipient)) {
    throw new Error("That is not an Ethereum address");
  }
  if (args.amount < MINIMUM_BURN) {
    throw new Error("Bridge at least 0.1 USDC - Circle's fee comes out of the amount");
  }

  const chain = starknetOf(args.network);
  const sdk = privacySdkOf(args.network);

  const info = await fetch(`/api/bridge/burn?network=${args.network}`).then((r) => r.json());
  if (!info?.relayer) {
    throw new Error(info?.error ?? "MorokPay cannot relay a burn on this network");
  }

  /* Naming the relayer as `caller` is what stops this signature being replayed
     by anybody else who sees it. */
  const intent: OutsideExecutionIntent = {
    caller: info.relayer,
    nonce: num.toHex(
      BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex")}`),
    ),
    executeAfter: 0,
    executeBefore: Math.floor(Date.now() / 1000) + 600,
    calls: [
      {
        to: chain.usdc,
        selector: hash.getSelectorFromName("approve"),
        calldata: approveUsdcCall(args.amount, chain.usdc, chain.tokenMessengerMinter)
          .calldata as string[],
      },
      {
        to: chain.tokenMessengerMinter,
        selector: hash.getSelectorFromName("deposit_for_burn"),
        calldata: depositForBurnCall({
          amount: args.amount,
          mintRecipient: evmAddressToBytes32(args.recipient),
          usdc: chain.usdc,
          minter: chain.tokenMessengerMinter,
        }).calldata as string[],
      },
    ],
  };

  progress("Approve the gasless bridge in your wallet");
  const typedData = eth712OutsideExecutionTypedData({
    accountAddress: validateAndParseAddress(args.starknetAddress),
    snChainName: sdk.snChainName,
    evmChainId: args.evmChainId,
    intent,
  });
  const signature = await args.signTypedData(
    typedData as unknown as Record<string, unknown>,
  );
  const felts = ethSignatureToAccountFelts(signature, args.evmChainId) as string[];
  const calldata = packOutsideExecutionCalldata(intent, felts);

  /* The same ownership proof the deploy route takes, so the server can tie the
     request to an EVM address without trusting the body. */
  const ownership = await args.signMessage(OWNERSHIP_MESSAGE);

  progress("MorokPay is submitting the burn");
  const response = await fetch("/api/bridge/burn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      network: args.network,
      evmAddress: args.evmAddress,
      signature: ownership,
      calldata,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.transactionHash) {
    throw new Error(payload?.error ?? "The relayer could not submit the burn");
  }
  return { transactionHash: String(payload.transactionHash) };
}
