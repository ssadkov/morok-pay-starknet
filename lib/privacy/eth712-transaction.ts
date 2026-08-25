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
