/**
 * Sends a plain public STRK transfer from one of the project's own
 * .secrets/<network>-accounts.json roles to any address. Nothing more than
 * a wallet send - no contract logic, no pool interaction.
 *
 * Deliberately a script you run yourself, not something an agent invokes on
 * your behalf: moving funds should be a step you press "go" on.
 *
 * Usage:
 *   node scripts/transfer-strk.mjs <role> <recipient> <amountStrk> [network]
 *   node scripts/transfer-strk.mjs deployer 0x06c9...887a9 15 mainnet
 */

import { readFileSync } from "node:fs";
import { Account, RpcProvider, cairo } from "starknet";

import { resolveNetwork, STRK } from "./lib/networks.mjs";

const [role, recipientArg, amountArg, networkArg] = process.argv.slice(2);
if (!role || !recipientArg || !amountArg) {
  console.error(
    "Usage: node scripts/transfer-strk.mjs <role> <recipient> <amountStrk> [network]",
  );
  process.exit(1);
}

const network = resolveNetwork(networkArg);
const recipient = recipientArg.startsWith("0x") ? recipientArg : `0x${recipientArg}`;
const amount = BigInt(Math.round(Number(amountArg) * 1e6)) * BigInt(10) ** BigInt(12);
if (amount <= 0n) throw new Error("Amount must be greater than zero.");

const store = JSON.parse(readFileSync(network.accountsFile, "utf8"));
const entry = store.accounts.find((item) => item.role === role);
if (!entry) throw new Error(`No account with role "${role}" in ${network.accountsFile}`);

const provider = new RpcProvider({ nodeUrl: network.rpc });
const account = new Account({
  provider,
  address: entry.address,
  signer: entry.privateKey,
  cairoVersion: "1",
});

const [balanceLow] = await provider.callContract({
  contractAddress: STRK,
  entrypoint: "balance_of",
  calldata: [entry.address],
});
const balance = BigInt(balanceLow);
console.log(`${role} (${entry.address}) holds ${(Number(balance) / 1e18).toFixed(4)} STRK`);
console.log(`Sending ${(Number(amount) / 1e18).toFixed(4)} STRK to ${recipient} on ${network.name}`);
if (balance < amount) throw new Error("Insufficient balance for this transfer.");

const value = cairo.uint256(amount);
const call = {
  contractAddress: STRK,
  entrypoint: "transfer",
  calldata: [recipient, value.low.toString(), value.high.toString()],
};

const submission = await account.execute(call);
console.log(`tx ${submission.transaction_hash}`);
console.log(`${network.explorer}/tx/${submission.transaction_hash}`);

const receipt = await provider.waitForTransaction(submission.transaction_hash);
console.log(`status: ${receipt.execution_status ?? "see explorer"}`);
