/**
 * Deploys one of the generated accounts once it holds STRK for fees.
 *
 * Usage:
 *   node scripts/deploy-account.mjs deployer            // sepolia
 *   node scripts/deploy-account.mjs deployer mainnet
 */

import { readFileSync } from "node:fs";
import { Account, CallData, RpcProvider } from "starknet";

import { resolveNetwork, STRK } from "./lib/networks.mjs";

const ROLE = process.argv[2] ?? "deployer";
const network = resolveNetwork(process.argv[3]);

const store = JSON.parse(readFileSync(network.accountsFile, "utf8"));
const entry = store.accounts.find((item) => item.role === ROLE);
if (!entry) throw new Error(`No account with role "${ROLE}"`);

const provider = new RpcProvider({ nodeUrl: network.rpc });

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
    `${ROLE} at ${entry.address} holds no STRK on ${network.name}. Fund it first.`,
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

console.log(`deploying ${ROLE} on ${network.name}: ${transaction_hash}`);
await provider.waitForTransaction(transaction_hash);
console.log(`${ROLE} live at ${contract_address}`);
