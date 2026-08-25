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
const UINT128_MASK = (BigInt(1) << BigInt(128)) - BigInt(1);

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
