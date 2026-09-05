import { num } from "starknet";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import {
  eth712OutsideExecutionTypedData,
  outsideExecutionCalldata,
  type IntentCall,
} from "@/lib/privacy/eth712-outside-execution";

/**
 * The account a V2 link controls.
 *
 * A link is an EVM private key, so the "owner" the escrow checks is the
 * Starknet account that key derives - the same derivation a real MetaMask
 * user gets, applied to a key nobody has ever used. That is what makes an
 * invoice to an address and a bearer link one contract rule instead of two.
 *
 * Nothing here touches the network: the address is computable from the key
 * alone, which is why a sender can park funds for a link before the account
 * behind it exists.
 */
export function ephemeralEvmAddress(seed: Hex): Hex {
  return privateKeyToAccount(seed).address;
}

const MASK_128 = (BigInt(1) << BigInt(128)) - BigInt(1);

/**
 * The signature the account factory wants before it will deploy for this key,
 * proving whoever asked holds it.
 */
export async function signEphemeralOwnership(
  seed: Hex,
  message: string,
): Promise<Hex> {
  return privateKeyToAccount(seed).signMessage({ message });
}

/**
 * Sign "claim this entry, pay it to that destination" as an intent somebody
 * else submits and pays for.
 *
 * The destination is inside the signed struct, which is the whole reason a V2
 * claim can be relayed at all. V1 put a bare secret in calldata and let the
 * submitter pick where the money went, so relaying it meant trusting the
 * relayer; here a relayer can only submit the payment the link's holder
 * already authorised, or nothing.
 */
export async function signEphemeralClaim(args: {
  seed: Hex;
  starknetAddress: string;
  snChainName: string;
  evmChainId: number;
  /** Pinned into the intent so nobody else can submit it. */
  caller: string;
  call: IntentCall;
  /** Unix seconds; the account refuses the intent after this. */
  executeBefore: number;
}): Promise<{ calldata: string[]; signature: string[] }> {
  const account = privateKeyToAccount(args.seed);
  const intent = {
    caller: args.caller,
    /* One-shot by construction: a random nonce the account records as used,
       so a leaked intent cannot be replayed even before it expires. */
    nonce: num.toHex(
      BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex")}`),
    ),
    executeAfter: 0,
    executeBefore: args.executeBefore,
    calls: [args.call],
  };

  const typedData = eth712OutsideExecutionTypedData({
    accountAddress: args.starknetAddress,
    snChainName: args.snChainName,
    evmChainId: args.evmChainId,
    intent,
  });
  const signature = await account.signTypedData(
    typedData as unknown as Parameters<typeof account.signTypedData>[0],
  );

  const r = BigInt(`0x${signature.slice(2, 66)}`);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);
  const felts = [
    r >> BigInt(128),
    r & MASK_128,
    s >> BigInt(128),
    s & MASK_128,
    /* The account wants the legacy 27/28 form; eth_signTypedData_v4 may hand
       back either that or a bare parity bit. */
    BigInt(v < 27 ? v + 27 : v),
    BigInt(args.evmChainId),
  ].map((value) => num.toHex(value));

  const struct = outsideExecutionCalldata(intent);
  const calldata = [
    struct.caller,
    struct.nonce,
    struct.execute_after,
    struct.execute_before,
    num.toHex(struct.calls.length),
    ...struct.calls.flatMap((call) => [
      call.to,
      call.selector,
      num.toHex(call.calldata.length),
      ...call.calldata,
    ]),
    num.toHex(felts.length),
    ...felts,
  ];
  return { calldata, signature: felts };
}
