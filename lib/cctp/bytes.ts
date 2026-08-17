import { CallData, type ByteArray, type Call } from "starknet";
import { padHex, type Hex } from "viem";

import { CCTP_MESSAGE_TRANSMITTER } from "@/lib/starknet/constants";

const BYTES_PER_WORD = 31;

export function hexToByteArray(hex: string): ByteArray {
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

export function starkAddressToBytes32(address: string): Hex {
  const hex = address.replace(/^0x/i, "") as Hex;
  return padHex(`0x${hex}`, { size: 32 });
}

export function receiveMessageCall(
  messageHex: string,
  attestationHex: string,
): Call {
  return {
    contractAddress: CCTP_MESSAGE_TRANSMITTER,
    entrypoint: "receive_message",
    calldata: CallData.compile({
      message: hexToByteArray(messageHex),
      attestation: hexToByteArray(attestationHex),
    }),
  };
}
