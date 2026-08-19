/**
 * Sends STRK from the deployer to another generated role or a raw address.
 *
 * Usage: node scripts/fund-account.mjs <role|address> <amountStrk> [network]
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider, json, uint256 } from "starknet";

import { resolveNetwork, STRK } from "./lib/networks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
const amountStrk = process.argv[3];
if (!target || !amountStrk) {
  throw new Error("Usage: fund-account.mjs <role|address> <amountStrk> [network]");
}
const network = resolveNetwork(process.argv[4]);

const store = json.parse(readFileSync(join(ROOT, network.accountsFile), "utf8"));
const deployer = store.accounts.find((item) => item.role === "deployer");
const to = target.startsWith("0x")
  ? target
  : store.accounts.find((item) => item.role === target)?.address;
if (!to) throw new Error(`No account with role "${target}"`);

const amount = BigInt(Math.round(Number(amountStrk) * 1e18));
const provider = new RpcProvider({ nodeUrl: network.rpc });
const account = new Account({
  provider,
  address: deployer.address,
  signer: deployer.privateKey,
});

const { transaction_hash } = await account.execute({
  contractAddress: STRK,
  entrypoint: "transfer",
  calldata: [to, ...Object.values(uint256.bnToUint256(amount))],
});
await provider.waitForTransaction(transaction_hash);
console.log(`sent ${amountStrk} STRK to ${to}`);
console.log(`${network.explorer}/tx/${transaction_hash}`);
