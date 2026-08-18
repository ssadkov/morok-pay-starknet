/**
 * Deploys one of the generated Sepolia accounts once it holds STRK for fees.
 *
 * Usage: node scripts/deploy-account.mjs [role]   // default: deployer
 */

import { readFileSync } from "node:fs";
import { Account, CallData, RpcProvider } from "starknet";

const RPC =
  process.env.STARKNET_SEPOLIA_RPC_URL ??
  "https://api.cartridge.gg/x/starknet/sepolia";
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ROLE = process.argv[2] ?? "deployer";

const store = JSON.parse(
  readFileSync(".secrets/sepolia-accounts.json", "utf8"),
);
const entry = store.accounts.find((item) => item.role === ROLE);
if (!entry) throw new Error(`No account with role "${ROLE}"`);

const provider = new RpcProvider({ nodeUrl: RPC });

try {
  await provider.getClassHashAt(entry.address);
  console.log(`${ROLE} already deployed at ${entry.address}`);
  process.exit(0);
} catch {
  // Not deployed yet, continue.
}

const [low = "0x0"] = await provider.callContract({
  contractAddress: STRK,
  entrypoint: "balance_of",
  calldata: [entry.address],
});
if (BigInt(low) === BigInt(0)) {
  console.error(
    `${ROLE} at ${entry.address} holds no STRK. Fund it from a Sepolia faucet first.`,
  );
  process.exit(1);
}

const account = new Account({
  provider,
  address: entry.address,
  signer: entry.privateKey,
});

const { transaction_hash, contract_address } = await account.deployAccount({
  classHash: store.classHash,
  constructorCalldata: CallData.compile({ publicKey: entry.publicKey }),
  addressSalt: entry.publicKey,
});

console.log(`deploying ${ROLE}: ${transaction_hash}`);
await provider.waitForTransaction(transaction_hash);
console.log(`${ROLE} live at ${contract_address}`);
