import { defaultAppNetwork, type AppNetwork } from "@/lib/network";

const MAINNET = {
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
  messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
  explorer: "https://basescan.org",
  iris: "https://iris-api.circle.com/v2/messages",
} as const;

const SEPOLIA = {
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
  explorer: "https://sepolia.basescan.org",
  iris: "https://iris-api-sandbox.circle.com/v2/messages",
} as const;

const CCTP = {
  mainnet: MAINNET,
  sepolia: SEPOLIA,
} as const;

export function cctpOf(network: AppNetwork) {
  return CCTP[network];
}

const NETWORK = cctpOf(defaultAppNetwork());

export const BASE_USDC = NETWORK.usdc;
export const BASE_TOKEN_MESSENGER_V2 = NETWORK.tokenMessenger;
export const BASE_MESSAGE_TRANSMITTER_V2 = NETWORK.messageTransmitter;
export const BASE_EXPLORER = NETWORK.explorer;
export const IRIS_API_URL = NETWORK.iris;

export const CCTP_DOMAIN_BASE = 6;
export const CCTP_DOMAIN_STARKNET = 25;

/** Finalized attestation. Fast Transfer is unused so maxFee can stay 0. */
export const CCTP_MIN_FINALITY_THRESHOLD = 2000;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const tokenMessengerV2Abi = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
] as const;

export const messageTransmitterV2Abi = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
