import { sha256, type Address, type Hex } from "viem";

export const TEST_STARKNET_CHAIN = "SN_SEPOLIA";
export const TEST_PRIVACY_POOL =
  0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91n;
export const TEST_ACCOUNT_FACTORY =
  0x078ce3c3e3080a579d268feae011761b32146efd40f4faa14dc8b9a30b4de35fn;

/**
 * The viewing-key signature carries no chain id at all.
 *
 * It used to carry whichever network MetaMask happened to be on. The derived
 * Starknet address does not depend on that, but the viewing key did - so
 * switching networks silently produced a different key, the indexer refused it
 * against the one registered in the pool, and the account's private balance
 * became unreadable. Our own onboarding made that near-certain by switching
 * the wallet to Base to bridge and never switching it back.
 *
 * The first attempt at a fix pinned the id to 1 instead, which was worse:
 * `chainId` in an EIP-712 domain is checked by the wallet, so a wallet on any
 * other network refuses to sign at all - and the refusal lands on activation
 * and on every later read. Leaving the field out is what actually makes the
 * derivation independent of the network, because there is then nothing for the
 * wallet to compare. Every domain field is optional under EIP-712.
 *
 * A viewing key is immutable once registered, so this cannot change again
 * without orphaning the accounts registered under the old rule. Callers that
 * have to read one of those pass the chain id it was registered with, and
 * signing that one is only asked for while the wallet is on that same network.
 */
export function privacyKeyTypedData(args: {
  evmAddress: Address;
  /** Only for reading an account registered before the id was dropped. */
  evmChainId?: number;
  starknetChain?: string;
  privacyPool?: bigint;
  accountFactory?: bigint;
}) {
  return {
    domain:
      args.evmChainId === undefined
        ? { name: "MorokPay Privacy Access", version: "1" }
        : {
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
      starknetChain: args.starknetChain ?? TEST_STARKNET_CHAIN,
      privacyPool: args.privacyPool ?? TEST_PRIVACY_POOL,
      accountFactory: args.accountFactory ?? TEST_ACCOUNT_FACTORY,
    },
  } as const;
}

/** A short diagnostic only. The raw signature must not enter UI state or logs. */
export function signatureFingerprint(signature: Hex) {
  return `${sha256(signature).slice(0, 18)}…`;
}
