import { CallData, cairo, type Call } from "starknet";
import { getAddress, isAddress, padHex, type Hex } from "viem";

import {
  CCTP_DOMAIN_BASE,
  CCTP_MIN_FINALITY_THRESHOLD,
} from "@/lib/cctp/constants";

const BYTES_PER_WORD = 31;

type ByteArrayLike = {
  data: string[];
  pending_word: string;
  pending_word_len: number;
};

export function hexToByteArray(hex: string): ByteArrayLike {
  const clean = hex.replace(/^0x/i, "");
  if (clean.length % 2 !== 0) {
    throw new Error("Hex payload must have an even length");
  }

  const data: string[] = [];
  let offset = 0;
  const wordChars = BYTES_PER_WORD * 2;
  while (offset + wordChars <= clean.length) {
    data.push(`0x${clean.slice(offset, offset + wordChars)}`);
    offset += wordChars;
  }

  const pending = clean.slice(offset);
  return {
    data,
    pending_word: pending ? `0x${pending}` : "0x0",
    pending_word_len: pending.length / 2,
  };
}

export function toHexBytes(value: string): Hex {
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

export function irisTransactionHash(hash: string): string {
  const hex = hash.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]+$/.test(hex) || hex.length > 64) {
    throw new Error("Invalid transaction hash");
  }
  return `0x${hex.padStart(64, "0")}`;
}

export function starkAddressToBytes32(address: string): Hex {
  const hex = address.replace(/^0x/i, "") as Hex;
  return padHex(`0x${hex}`, { size: 32 });
}

export function evmAddressToBytes32(address: string): Hex {
  if (!isAddress(address)) {
    throw new Error("Enter a valid Base address");
  }
  return padHex(getAddress(address).toLowerCase() as Hex, { size: 32 });
}

export function receiveMessageCall(
  messageHex: string,
  attestationHex: string,
  transmitter: string,
): Call {
  return {
    contractAddress: transmitter,
    entrypoint: "receive_message",
    calldata: CallData.compile({
      message: hexToByteArray(messageHex),
      attestation: hexToByteArray(attestationHex),
    }),
  };
}

export function approveUsdcCall(
  amount: bigint,
  usdc: string,
  minter: string,
): Call {
  return {
    contractAddress: usdc,
    entrypoint: "approve",
    calldata: CallData.compile({
      spender: minter,
      amount: cairo.uint256(amount),
    }),
  };
}

export function depositForBurnCall(params: {
  amount: bigint;
  mintRecipient: Hex;
  usdc: string;
  minter: string;
  destinationDomain?: number;
  destinationCaller?: Hex;
  maxFee?: bigint;
  minFinalityThreshold?: number;
}): Call {
  return {
    contractAddress: params.minter,
    entrypoint: "deposit_for_burn",
    calldata: CallData.compile({
      amount: cairo.uint256(params.amount),
      destination_domain: params.destinationDomain ?? CCTP_DOMAIN_BASE,
      mint_recipient: cairo.uint256(BigInt(params.mintRecipient)),
      burn_token: params.usdc,
      destination_caller: cairo.uint256(
        BigInt(params.destinationCaller ?? "0x0"),
      ),
      max_fee: cairo.uint256(params.maxFee ?? BigInt(0)),
      min_finality_threshold:
        params.minFinalityThreshold ?? CCTP_MIN_FINALITY_THRESHOLD,
    }),
  };
}
