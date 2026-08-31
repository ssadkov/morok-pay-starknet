import { num, type BigNumberish } from "starknet";
import { hashTypedData, padHex, toHex, type Address } from "viem";

import { ETH712_TRANSACTION_TYPES } from "./eth712-transaction";

/**
 * The signature that lets somebody else pay for this account's transaction.
 *
 * `execute_from_outside_v2` is the one entry point on this account class that
 * a third party can call: it takes an intent the owner signed and a caller
 * named inside it, and runs the calls without the owner ever submitting
 * anything. The account class registers SRC9 explicitly "as paymaster
 * requires this", so this is what it was built for.
 *
 * What matters here is that the account does **not** trust any typed data it
 * is shown. It rebuilds the hash from the struct itself, as EIP-712 over the
 * EVM chain id - not SNIP-12, which is what a Starknet-native paymaster will
 * hand you. So a paymaster's own typed data is a display artifact; the bytes
 * that have to match are the ones below, and they are transcribed from
 * `eth_712_utils.cairo`:
 *
 *   Call(uint256 address,uint256 selector,uint256[] data)
 *   OutsideExecution(Call[] calls,uint256 caller,uint256 nonce,
 *                    uint256 execute_after,uint256 execute_before)
 *
 * Field order is load-bearing - `calls` comes first, before `caller` - and the
 * envelope is the same domain separator the ordinary transaction path already
 * uses, which is why that part is imported rather than restated.
 */

const MASK_128 = (BigInt(1) << BigInt(128)) - BigInt(1);

export const ETH712_OUTSIDE_EXECUTION_TYPES = {
  EIP712Domain: ETH712_TRANSACTION_TYPES.EIP712Domain,
  Call: ETH712_TRANSACTION_TYPES.Call,
  OutsideExecution: [
    { name: "calls", type: "Call[]" },
    { name: "caller", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "execute_after", type: "uint256" },
    { name: "execute_before", type: "uint256" },
  ],
} as const;

/**
 * Selectors here are already hashed. A paymaster composes the intent in that
 * form, and turning a selector back into a name to re-hash it would sign a
 * different call than the one that gets submitted.
 */
export type IntentCall = {
  to: BigNumberish;
  selector: BigNumberish;
  calldata: BigNumberish[];
};

export type OutsideExecutionIntent = {
  caller: BigNumberish;
  nonce: BigNumberish;
  executeAfter: BigNumberish;
  executeBefore: BigNumberish;
  calls: IntentCall[];
};

const asBigInt = (value: BigNumberish) => num.toBigInt(value);

export function eth712OutsideExecutionTypedData(args: {
  accountAddress: BigNumberish;
  snChainName: string;
  evmChainId: BigNumberish;
  intent: OutsideExecutionIntent;
}) {
  /* The full address will not fit an EIP-712 verifyingContract, so the class
     uses its low 128 bits. Same trick as the transaction path. */
  const verifyingContract = padHex(
    toHex(asBigInt(args.accountAddress) & MASK_128),
    { size: 20 },
  ) as Address;

  return {
    domain: {
      name: args.snChainName,
      version: "2",
      chainId: asBigInt(args.evmChainId),
      verifyingContract,
    },
    types: ETH712_OUTSIDE_EXECUTION_TYPES,
    primaryType: "OutsideExecution" as const,
    message: {
      calls: args.intent.calls.map((call) => ({
        address: asBigInt(call.to),
        selector: asBigInt(call.selector),
        data: call.calldata.map(asBigInt),
      })),
      caller: asBigInt(args.intent.caller),
      nonce: asBigInt(args.intent.nonce),
      execute_after: asBigInt(args.intent.executeAfter),
      execute_before: asBigInt(args.intent.executeBefore),
    },
  } as const;
}

export function eth712OutsideExecutionHash(
  typedData: ReturnType<typeof eth712OutsideExecutionTypedData>,
) {
  return hashTypedData(typedData);
}

/** The struct as `execute_from_outside_v2` wants it, felt for felt. */
export function outsideExecutionCalldata(intent: OutsideExecutionIntent) {
  return {
    caller: num.toHex(asBigInt(intent.caller)),
    nonce: num.toHex(asBigInt(intent.nonce)),
    execute_after: num.toHex(asBigInt(intent.executeAfter)),
    execute_before: num.toHex(asBigInt(intent.executeBefore)),
    calls: intent.calls.map((call) => ({
      to: num.toHex(asBigInt(call.to)),
      selector: num.toHex(asBigInt(call.selector)),
      calldata: call.calldata.map((value) => num.toHex(asBigInt(value))),
    })),
  };
}
