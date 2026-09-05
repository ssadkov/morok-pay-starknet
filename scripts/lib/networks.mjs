/**
 * Network table for the deploy helpers. Mirrors MAINNET/SEPOLIA in
 * lib/starknet/constants.ts — keep the pool addresses in sync.
 */

export const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** OpenZeppelin Account v1.0.0. */
export const OZ_CLASS_HASH =
  "0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

const NETWORKS = {
  sepolia: {
    rpcEnv: "STARKNET_SEPOLIA_RPC_URL",
    defaultRpc: "https://api.cartridge.gg/x/starknet/sepolia",
    pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
    usdc: "0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343",
    explorer: "https://sepolia.voyager.online",
  },
  mainnet: {
    rpcEnv: "STARKNET_RPC_URL",
    defaultRpc: "https://rpc.starknet.lava.build",
    pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    usdc: "0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb",
    explorer: "https://voyager.online",
  },
};

/** Reads the network from argv, defaulting to Sepolia so a slip stays cheap. */
export function resolveNetwork(value = "sepolia") {
  const spec = NETWORKS[value];
  if (!spec) {
    throw new Error(`Unknown network "${value}". Use sepolia or mainnet.`);
  }
  return {
    name: value,
    ...spec,
    rpc: process.env[spec.rpcEnv] ?? spec.defaultRpc,
    accountsFile: `.secrets/${value}-accounts.json`,
    contractsFile: `.secrets/${value}-contracts.json`,
  };
}
