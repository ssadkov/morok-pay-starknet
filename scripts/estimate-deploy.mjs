/**
 * Estimates what a MorokInvoices deploy costs before funding the deployer.
 *
 * Usage: node scripts/estimate-deploy.mjs [network]   // default: sepolia
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, CallData, RpcProvider, json } from "starknet";

import { resolveNetwork } from "./lib/networks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const network = resolveNetwork(process.argv[2]);

const store = json.parse(readFileSync(join(ROOT, network.accountsFile), "utf8"));
const deployer = store.accounts.find((item) => item.role === "deployer");

const provider = new RpcProvider({ nodeUrl: network.rpc });
const account = new Account({
  provider,
  address: deployer.address,
  signer: deployer.privateKey,
});

const strk = (wei) => `${(Number(wei) / 1e18).toFixed(4)} STRK`;

const accountFee = await account.estimateAccountDeployFee({
  classHash: store.classHash,
  constructorCalldata: CallData.compile({ publicKey: deployer.publicKey }),
  addressSalt: deployer.publicKey,
});
console.log(`deploy account  ${strk(accountFee.overall_fee)}`);

const sierra = json.parse(
  readFileSync(
    join(ROOT, "contracts", "target", "dev", "morok_pay_MorokInvoices.contract_class.json"),
    "utf8",
  ),
);
const casm = json.parse(
  readFileSync(
    join(
      ROOT,
      "contracts",
      "target",
      "dev",
      "morok_pay_MorokInvoices.compiled_contract_class.json",
    ),
    "utf8",
  ),
);

// Only possible once the deployer exists on chain — it has to sign the estimate.
try {
  const declareFee = await account.estimateDeclareFee({ contract: sierra, casm });
  console.log(`declare         ${strk(declareFee.overall_fee)}`);
} catch (error) {
  console.log(`declare         not estimable yet (${error.message.slice(0, 80)})`);
}
