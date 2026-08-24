import { sha256, type Address, type Hex } from "viem";

export const TEST_STARKNET_CHAIN = "SN_SEPOLIA";
export const TEST_PRIVACY_POOL =
  0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91n;
export const TEST_ACCOUNT_FACTORY =
  0x078ce3c3e3080a579d268feae011761b32146efd40f4faa14dc8b9a30b4de35fn;

export function privacyKeyTypedData(args: {
  evmAddress: Address;
  evmChainId: number;
}) {
  return {
    domain: {
      name: "MorokPay Privacy Access",
      version: "1",
      chainId: args.evmChainId,
    },
    types: {
      PrivacyAccess: [
        { name: "purpose", type: "string" },
        { name: "evmAccount", type: "address" },
        { name: "starknetChain", type: "string" },
        { name: "privacyPool", type: "uint256" },
        { name: "accountFactory", type: "uint256" },
      ],
    },
    primaryType: "PrivacyAccess" as const,
    message: {
      purpose: "Derive the MorokPay STRK20 viewing key",
      evmAccount: args.evmAddress,
      starknetChain: TEST_STARKNET_CHAIN,
      privacyPool: TEST_PRIVACY_POOL,
      accountFactory: TEST_ACCOUNT_FACTORY,
    },
  } as const;
}

/** A short diagnostic only. The raw signature must not enter UI state or logs. */
export function signatureFingerprint(signature: Hex) {
  return `${sha256(signature).slice(0, 18)}…`;
}
