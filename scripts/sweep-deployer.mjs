/**
 * Sends the deployer's leftover STRK to a wallet address, keeping a little back
 * for gas. Useful once a deploy is done and the account is idle.
 *
 * Usage: node scripts/sweep-deployer.mjs <to> [network] [keepStrk]
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider, json, uint256 } from "starknet";

import { resolveNetwork, STRK } from "./lib/networks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const to = process.argv[2];
if (!to) throw new Error("Pass the destination address");
const network = resolveNetwork(process.argv[3]);
const keep = BigInt(
  Math.round(Number(process.argv[4] ?? "0.4") * 1e18),
);

const store = json.parse(readFileSync(join(ROOT, network.accountsFile), "utf8"));
const deployer = store.accounts.find((item) => item.role === "deployer");

const provider = new RpcProvider({ nodeUrl: network.rpc });
const [low = "0x0", high = "0x0"] = await provider.callContract({
  contractAddress: STRK,
  entrypoint: "balance_of",
  calldata: [deployer.address],
});
const balance = BigInt(low) + (BigInt(high) << BigInt(128));
if (balance <= keep) {
  console.error(`Nothing to sweep: ${balance} wei, keeping ${keep}`);
  process.exit(1);
}

const amount = balance - keep;
const account = new Account({
  provider,
  address: deployer.address,
  signer: deployer.privateKey,
});

console.log(`sending ${Number(amount) / 1e18} STRK to ${to}`);
const { transaction_hash } = await account.execute({
  contractAddress: STRK,
  entrypoint: "transfer",
  calldata: [to, ...Object.values(uint256.bnToUint256(amount))],
});
await provider.waitForTransaction(transaction_hash);
console.log(`${network.explorer}/tx/${transaction_hash}`);
