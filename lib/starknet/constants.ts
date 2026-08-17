export const STARKNET_NETWORK =
  process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "mainnet";

const MAINNET = {
  rpc:
    process.env.NEXT_PUBLIC_STARKNET_RPC_URL ??
    "https://rpc.starknet.lava.build",
  explorer: "https://voyager.online",
  usdc: "0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb",
  pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  messageTransmitter:
    "0x02EBB5777B6dD8B26ea11D68Fdf1D2c85cD2099335328Be845a28c77A8AEf183",
} as const;

const SEPOLIA = {
  rpc:
    process.env.NEXT_PUBLIC_STARKNET_RPC_URL ??
    "https://api.cartridge.gg/x/starknet/sepolia",
  explorer: "https://sepolia.voyager.online",
  usdc: "0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343",
  pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  messageTransmitter:
    "0x04db7926C64f1f32a840F3Fa95cB551f3801a3600Bae87aF87807A54DCE12Fe8",
} as const;

const NETWORK = STARKNET_NETWORK === "sepolia" ? SEPOLIA : MAINNET;

export const STARKNET_RPC_URL = NETWORK.rpc;
export const EXPLORER_URL = NETWORK.explorer;
export const USDC_ADDRESS = NETWORK.usdc;
export const STRK20_POOL_ADDRESS = NETWORK.pool;
export const CCTP_MESSAGE_TRANSMITTER = NETWORK.messageTransmitter;

export const STRK_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export const READY_WALLET_URL = "https://www.ready.co/";

/** OpenZeppelin Account v1.0.0 — kept for the older derive path. */
export const OZ_ACCOUNT_CLASS_HASH =
  "0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

export const ACCOUNT_ACTION = "derive-starknet-account-v1";
export const ACCOUNT_KEY_DOMAIN = "morokpay.starknet.account.v1";
export const VIEWING_KEY_DOMAIN = "pharaoh.strk20.viewing_key.v1";
export const STARK_CURVE_ORDER = BigInt(
  "0x0800000000000011000000000000000000000000000000000000000000000001",
);

export const STRK20_PROVING_URL =
  process.env.NEXT_PUBLIC_STRK20_PROVING_URL ?? "/privacy/prover";
export const STRK20_INDEXER_URL =
  process.env.NEXT_PUBLIC_STRK20_INDEXER_URL ?? "/privacy/indexer";
export const NOTE_MATURITY_BLOCKS = 10;
