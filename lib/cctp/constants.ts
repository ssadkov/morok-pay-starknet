import { STARKNET_NETWORK } from "@/lib/starknet/constants";

const MAINNET = {
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
  iris: "https://iris-api.circle.com/v2/messages",
} as const;

const SEPOLIA = {
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be1647DA0",
  iris: "https://iris-api-sandbox.circle.com/v2/messages",
} as const;

const NETWORK = STARKNET_NETWORK === "sepolia" ? SEPOLIA : MAINNET;

export const ETHEREUM_USDC = NETWORK.usdc;
export const ETHEREUM_TOKEN_MESSENGER_V2 = NETWORK.tokenMessenger;
export const IRIS_API_URL = NETWORK.iris;

export const CCTP_DOMAIN_ETHEREUM = 0;
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
