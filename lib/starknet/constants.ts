import { defaultAppNetwork, type AppNetwork } from "@/lib/network";

const MAINNET = {
  rpc:
    process.env.NEXT_PUBLIC_STARKNET_RPC_URL ??
    "https://rpc.starknet.lava.build",
  explorer: "https://voyager.online",
  usdc: "0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb",
  pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  messageTransmitter:
    "0x02EBB5777B6dD8B26ea11D68Fdf1D2c85cD2099335328Be845a28c77A8AEf183",
  tokenMessengerMinter:
    "0x07d421B9cA8aA32DF259965cDA8ACb93F7599F69209A41872AE84638B2A20F2a",
  // MorokEscrow, declared and deployed 2026-09-04 by
  // scripts/deploy-contract.mjs. Same class hash as the Sepolia deployment
  // (0x53fe2c18...), so it is the contract the Sepolia probes exercised.
  escrow:
    "0x06199365a45fa8fe4874bb82727fdf5d849631cde9ca557f497abe7c4ccb698f",
  treasury:
    process.env.NEXT_PUBLIC_MOROK_TREASURY_MAINNET_ADDRESS?.trim() ?? "",
  // Declared 2026-08-26 by scripts/deploy-eth712-factory.mjs, configured for
  // the STRK20-compatible Eth712 account class. See
  // docs/metamask-privacy-sdk-sepolia.md for the declare and deploy hashes.
  accountFactory:
    "0x7ead3a89ae0a67ed6ba18caa1b9643437ff9432bab66ab0b2a27e46e0c627aa",
} as const;

const SEPOLIA = {
  rpc:
    process.env.NEXT_PUBLIC_STARKNET_SEPOLIA_RPC_URL ??
    "https://api.cartridge.gg/x/starknet/sepolia",
  explorer: "https://sepolia.voyager.online",
  usdc: "0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343",
  pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  messageTransmitter:
    "0x04db7926C64f1f32a840F3Fa95cB551f3801a3600Bae87aF87807A54DCE12Fe8",
  tokenMessengerMinter:
    "0x04bDdE1E09a4B09a2F95d893D94a967b7717eB85A3f6dEcA8c080Ee01fBc3370",
  escrow:
    "0x0407827c97ea537970b306f6ccbeb08c5f57224732280eb7b7a23184cad896a5",
  treasury:
    process.env.NEXT_PUBLIC_MOROK_TREASURY_SEPOLIA_ADDRESS?.trim() ??
    "0x00E5887fC74A11d10Ad5dd2f69D3911Fb352d9b811528a9281Ca8aBAc8498423",
  accountFactory:
    "0x078ce3c3e3080a579d268feae011761b32146efd40f4faa14dc8b9a30b4de35f",
} as const;

const STARKNET = {
  mainnet: MAINNET,
  sepolia: SEPOLIA,
} as const;

export function starknetOf(network: AppNetwork) {
  return STARKNET[network];
}

/** Default network from env. The UI switcher overrides this at runtime. */
export const STARKNET_NETWORK = defaultAppNetwork();

const NETWORK = starknetOf(STARKNET_NETWORK);

export const STARKNET_RPC_URL = NETWORK.rpc;
export const EXPLORER_URL = NETWORK.explorer;
export const USDC_ADDRESS = NETWORK.usdc;
export const STRK20_POOL_ADDRESS = NETWORK.pool;
export const CCTP_MESSAGE_TRANSMITTER = NETWORK.messageTransmitter;
export const CCTP_TOKEN_MESSENGER_MINTER = NETWORK.tokenMessengerMinter;

export const STRK_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export const READY_WALLET_URL =
  "https://chromewebstore.google.com/detail/ready-x/dlcobpjiigpikoobohmabehhmhfoodbb";
