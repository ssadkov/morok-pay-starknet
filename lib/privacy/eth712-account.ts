import { parseSignature, type Hex } from "viem";
import {
  addAddressPadding,
  num,
  RpcProvider,
  validateAndParseAddress,
  type Call,
} from "starknet";

import { starknetOf } from "@/lib/starknet/constants";
import { toCalldataFelt } from "@/lib/starknet/actions";

import { TEST_ACCOUNT_FACTORY } from "./eip712-test";

export const OWNERSHIP_MESSAGE = "Sign to verify that you own this account.";
export const EXPECTED_OWNERSHIP_MESSAGE_HASH =
  "0x3ce976d55131cd0bdd49f20afbded052d8e907dc6034d95cdf117a8fd7752e3c";
export const LEGACY_ETH712_ACCOUNT_CLASS_HASH =
  "0x39ffe6e5bffb04de53189d1f4018f113d7ddcbc8ca5874f7a4986b4d1a77f55";
export const STRK20_ETH712_ACCOUNT_CLASS_HASH =
  "0x697437b25b81bcdd2d1b231d3b8670849fb318555903dbc2fefce2a1a35586e";
const UINT128_MASK = (BigInt(1) << BigInt(128)) - BigInt(1);

export type Eth712Strk20ClassMode =
  | "compatible"
  | "atomic_upgrade_required"
  | "unsupported";

export type Eth712AccountInspection = {
  evmAddress: string;
  starknetAddress: string;
  factoryAddress: string;
  factoryClassHash: string;
  configuredAccountClassHash: string;
  deployed: boolean;
  deployedClassHash: string | null;
};

export function deployEth712AccountCall(args: {
  factoryAddress: string;
  evmAddress: string;
  signature: Hex;
}): Call {
  const { r, s, yParity } = parseSignature(args.signature);
  const rValue = BigInt(r);
  const sValue = BigInt(s);

  return {
    contractAddress: validateAndParseAddress(args.factoryAddress),
    entrypoint: "deploy_account",
    calldata: [
      toCalldataFelt(args.evmAddress),
      toCalldataFelt(rValue & UINT128_MASK),
      toCalldataFelt(rValue >> BigInt(128)),
      toCalldataFelt(sValue & UINT128_MASK),
      toCalldataFelt(sValue >> BigInt(128)),
      toCalldataFelt(BigInt(yParity)),
    ],
  };
}

export function eth712Strk20ClassMode(classHash: string): Eth712Strk20ClassMode {
  const value = BigInt(classHash);
  if (value === BigInt(STRK20_ETH712_ACCOUNT_CLASS_HASH)) return "compatible";
  if (value === BigInt(LEGACY_ETH712_ACCOUNT_CLASS_HASH)) {
    return "atomic_upgrade_required";
  }
  return "unsupported";
}

export function strk20UpgradeCall(accountAddress: string): Call {
  return {
    contractAddress: validateAndParseAddress(accountAddress),
    entrypoint: "upgrade",
    // Cairo Option::None is variant 1. No EIC initializer is needed because the
    // compatible class preserves src5, SRC9_nonces, and eth_address storage.
    calldata: [STRK20_ETH712_ACCOUNT_CLASS_HASH, "0x1"],
  };
}

type FactoryReader = {
  callContract(call: {
    contractAddress: string;
    entrypoint: string;
    calldata: string[];
  }): Promise<string[]>;
  getClassHashAt(address: string): Promise<string>;
};

function firstResult(values: string[], method: string) {
  if (!values[0]) throw new Error(`${method} returned no value`);
  return values[0];
}

export async function inspectEth712Account(
  evmAddress: string,
  reader: FactoryReader = new RpcProvider({
    nodeUrl: starknetOf("sepolia").rpc,
  }),
): Promise<Eth712AccountInspection> {
  const factoryAddress = addAddressPadding(TEST_ACCOUNT_FACTORY);
  const ethAddress = num.toHex(BigInt(evmAddress));
  const call = (entrypoint: string) =>
    reader.callContract({
      contractAddress: factoryAddress,
      entrypoint,
      calldata: [ethAddress],
    });

  const [expectedResult, deployedResult, accountClassResult, factoryClassHash] =
    await Promise.all([
      call("get_expected_account_address"),
      call("get_account"),
      reader.callContract({
        contractAddress: factoryAddress,
        entrypoint: "account_class_hash",
        calldata: [],
      }),
      reader.getClassHashAt(factoryAddress),
    ]);

  const starknetAddress = addAddressPadding(
    firstResult(expectedResult, "get_expected_account_address"),
  );
  const deployedAddress = BigInt(firstResult(deployedResult, "get_account"));
  if (deployedAddress !== 0n && deployedAddress !== BigInt(starknetAddress)) {
    throw new Error("Factory returned a different deployed account address");
  }
  const deployedClassHash =
    deployedAddress === 0n
      ? null
      : await reader.getClassHashAt(starknetAddress);

  return {
    evmAddress,
    starknetAddress,
    factoryAddress,
    factoryClassHash: num.toHex(factoryClassHash),
    configuredAccountClassHash: num.toHex(
      firstResult(accountClassResult, "account_class_hash"),
    ),
    deployed: deployedAddress !== 0n,
    deployedClassHash: deployedClassHash
      ? num.toHex(deployedClassHash)
      : null,
  };
}
