import {
  hashTypedData,
  padHex,
  parseSignature,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  hash,
  CallData,
  num,
  SignerInterface,
  type BigNumberish,
  type Call,
  type InvocationsSignerDetails,
  type ResourceBoundsBN,
  type Signature,
} from "starknet";

const MASK_128 = (BigInt(1) << BigInt(128)) - BigInt(1);

export const ETH712_TRANSACTION_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  Transaction: [
    { name: "calls", type: "Call[]" },
    { name: "metadata", type: "TransactionMetadata" },
  ],
  Call: [
    { name: "address", type: "uint256" },
    { name: "selector", type: "uint256" },
    { name: "data", type: "uint256[]" },
  ],
  TransactionMetadata: [
    { name: "version", type: "uint256" },
    { name: "chain_id", type: "uint256" },
    { name: "execution_resources", type: "uint256[]" },
    { name: "tip", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const RESOURCE_IDS = {
  l1Gas: BigInt("0x4c315f474153"),
  l2Gas: BigInt("0x4c325f474153"),
  l1Data: BigInt("0x4c315f44415441"),
};

function asBigInt(value: BigNumberish) {
  return num.toBigInt(value);
}

export function eth712TransactionTypedData(args: {
  accountAddress: BigNumberish;
  calls: Call[];
  details: InvocationsSignerDetails;
  snChainName: string;
  evmChainId: BigNumberish;
}) {
  const resources = args.details.resourceBounds;
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
    types: ETH712_TRANSACTION_TYPES,
    primaryType: "Transaction" as const,
    message: {
      calls: args.calls.map((call) => ({
        address: asBigInt(call.contractAddress),
        selector: asBigInt(hash.getSelectorFromName(call.entrypoint)),
        data: CallData.toCalldata(call.calldata).map(asBigInt),
      })),
      metadata: {
        version: asBigInt(args.details.version),
        chain_id: asBigInt(args.details.chainId),
        execution_resources: [
          RESOURCE_IDS.l1Gas,
          resources.l1_gas.max_amount,
          resources.l1_gas.max_price_per_unit,
          RESOURCE_IDS.l2Gas,
          resources.l2_gas.max_amount,
          resources.l2_gas.max_price_per_unit,
          RESOURCE_IDS.l1Data,
          resources.l1_data_gas.max_amount,
          resources.l1_data_gas.max_price_per_unit,
        ],
        tip: asBigInt(args.details.tip),
        nonce: asBigInt(args.details.nonce),
      },
    },
  } as const;
}

export function eth712TransactionHash(
  typedData: ReturnType<typeof eth712TransactionTypedData>,
) {
  return hashTypedData(typedData);
}

export function ethSignatureToAccountFelts(
  signature: Hex,
  evmChainId: BigNumberish,
): Signature {
  const { r, s, yParity } = parseSignature(signature);
  const rValue = BigInt(r);
  const sValue = BigInt(s);
  return [
    rValue >> BigInt(128),
    rValue & MASK_128,
    sValue >> BigInt(128),
    sValue & MASK_128,
    BigInt(27 + yParity),
    asBigInt(evmChainId),
  ].map(num.toHex);
}

type SignTypedData = (
  typedData: ReturnType<typeof eth712TransactionTypedData>,
) => Promise<Hex>;

function resourceCost(bounds: ResourceBoundsBN) {
  return (
    bounds.l1_gas.max_amount * bounds.l1_gas.max_price_per_unit +
    bounds.l2_gas.max_amount * bounds.l2_gas.max_price_per_unit +
    bounds.l1_data_gas.max_amount * bounds.l1_data_gas.max_price_per_unit
  );
}

export function eth712FundedResourceBounds(args: {
  estimated: ResourceBoundsBN;
  publicBalance: bigint;
  transferAmount: bigint;
}): ResourceBoundsBN {
  const nonL2Fee =
    args.estimated.l1_gas.max_amount *
      args.estimated.l1_gas.max_price_per_unit +
    args.estimated.l1_data_gas.max_amount *
      args.estimated.l1_data_gas.max_price_per_unit;
  const available = args.publicBalance - args.transferAmount - nonL2Fee;
  if (available <= BigInt(0)) {
    throw new Error("Insufficient public STRK for Eth712 validation");
  }

  const l2Price = args.estimated.l2_gas.max_price_per_unit;
  if (l2Price <= BigInt(0)) {
    throw new Error("Sepolia returned an invalid L2 gas price");
  }

  const l2Budget = (available * BigInt(9)) / BigInt(10);
  const maxAmount = l2Budget / l2Price;
  if (maxAmount <= args.estimated.l2_gas.max_amount) {
    throw new Error("Insufficient public STRK for Eth712 account validation");
  }

  const provisional = {
    ...args.estimated,
    l2_gas: {
      ...args.estimated.l2_gas,
      max_amount: maxAmount,
    },
  };
  if (resourceCost(provisional) + args.transferAmount > args.publicBalance) {
    throw new Error("Validation resource cap exceeds the public STRK balance");
  }
  return provisional;
}

function errorText(error: unknown, depth = 0): string {
  if (depth > 4 || error === null || error === undefined) return "";
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);
  const value = error as Record<string, unknown>;
  return [
    value.message,
    value.shortMessage,
    value.details,
    value.reason,
    value.data,
    value.baseError,
    value.cause,
    value.error,
  ]
    .map((entry) => errorText(entry, depth + 1))
    .filter(Boolean)
    .join(" ");
}

export function safeEth712TransactionError(error: unknown): string {
  const message = errorText(error);
  if (/user rejected|rejected the request|error code 4001/i.test(message)) {
    return "MetaMask signature request was rejected. Nothing was submitted.";
  }
  if (/out of gas/i.test(message)) {
    return "Starknet rejected the transaction because account validation ran out of L2 gas. Nothing was submitted.";
  }
  if (/insufficient account balance|insufficient resources/i.test(message)) {
    return "The generated Starknet account does not have enough public STRK for the transaction fee.";
  }
  if (/validation failed/i.test(message)) {
    return "Starknet rejected the account signature during validation. Nothing was submitted.";
  }
  return "MetaMask or Starknet rejected the request. Raw RPC transaction details are hidden.";
}

export class Eth712TransactionSigner extends SignerInterface {
  constructor(
    private readonly options: {
      accountAddress: BigNumberish;
      snChainName: string;
      evmChainId: BigNumberish;
      signTypedData: SignTypedData;
    },
  ) {
    super();
  }

  async signTransaction(
    calls: Call[],
    details: InvocationsSignerDetails,
  ): Promise<Signature> {
    const signature = await this.options.signTypedData(
      eth712TransactionTypedData({
        accountAddress: this.options.accountAddress,
        calls,
        details,
        snChainName: this.options.snChainName,
        evmChainId: this.options.evmChainId,
      }),
    );
    return ethSignatureToAccountFelts(signature, this.options.evmChainId);
  }

  async getPubKey(): Promise<string> {
    throw new Error("Eth712TransactionSigner: getPubKey is not supported");
  }

  async signMessage(): Promise<Signature> {
    throw new Error("Eth712TransactionSigner: signMessage is not supported");
  }

  async signDeclareTransaction(): Promise<Signature> {
    throw new Error(
      "Eth712TransactionSigner: signDeclareTransaction is not supported",
    );
  }

  async signDeployAccountTransaction(): Promise<Signature> {
    throw new Error(
      "Eth712TransactionSigner: signDeployAccountTransaction is not supported",
    );
  }
}
