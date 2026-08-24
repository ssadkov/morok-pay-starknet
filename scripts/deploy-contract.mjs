/**
 * Declares and deploys a compiled MorokPay helper on Starknet.
 *
 * Usage:
 *   node scripts/deploy-contract.mjs escrow
 *   node scripts/deploy-contract.mjs escrow mainnet
 *
 * Requires a funded deployer in .secrets/<network>-accounts.json and
 * `scarb build` artifacts under contracts/target/dev. On mainnet the declare
 * costs real STRK, so check the printed pool address before confirming.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, CallData, RpcProvider, json } from "starknet";

import { resolveNetwork } from "./lib/networks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = process.argv[2] ?? "escrow";
const network = resolveNetwork(process.argv[3]);

const CONTRACTS = {
  escrow: {
    name: "MorokEscrow",
    sierra: "morok_pay_MorokEscrow.contract_class.json",
    casm: "morok_pay_MorokEscrow.compiled_contract_class.json",
    constructor: [network.pool],
  },
};

const spec = CONTRACTS[TARGET];
if (!spec) {
  throw new Error(`Unknown target "${TARGET}". Use escrow.`);
}

const store = json.parse(
  readFileSync(join(ROOT, network.accountsFile), "utf8"),
);
const deployer = store.accounts.find((item) => item.role === "deployer");
if (!deployer) throw new Error("No deployer account in .secrets");

const sierraPath = join(ROOT, "contracts", "target", "dev", spec.sierra);
const casmPath = join(ROOT, "contracts", "target", "dev", spec.casm);
if (!existsSync(sierraPath) || !existsSync(casmPath)) {
  throw new Error(`Missing ${spec.name} artifacts. Run scarb build in contracts/.`);
}

const sierra = json.parse(readFileSync(sierraPath, "utf8"));
const casm = json.parse(readFileSync(casmPath, "utf8"));

const provider = new RpcProvider({ nodeUrl: network.rpc });
const account = new Account({
  provider,
  address: deployer.address,
  signer: deployer.privateKey,
});

console.log(`network    ${network.name} (${network.rpc})`);
if (spec.constructor.length > 0) {
  console.log(`constructor ${spec.constructor.join(", ")}`);
}
console.log(`declareAndDeploy ${spec.name} from ${deployer.address}`);
const result = await account.declareAndDeploy({
  contract: sierra,
  casm,
  constructorCalldata: CallData.compile(spec.constructor),
});

const classHash = result.declare.class_hash;
const address = result.deploy.contract_address ?? result.deploy.address;
console.log(`declare tx ${result.declare.transaction_hash || "(already declared)"}`);
console.log(`class      ${classHash}`);
console.log(`deploy tx  ${result.deploy.transaction_hash}`);
console.log(`${spec.name} live at ${address}`);
console.log(`${network.explorer}/contract/${address}`);

const outPath = join(ROOT, network.contractsFile);
mkdirSync(dirname(outPath), { recursive: true });
const previous = existsSync(outPath)
  ? json.parse(readFileSync(outPath, "utf8"))
  : { network: network.name };
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      ...previous,
      network: network.name,
      pool: network.pool,
      [TARGET]: {
        name: spec.name,
        classHash,
        address,
        constructor: spec.constructor,
      },
    },
    null,
    2,
  )}\n`,
);
console.log(`addresses written to ${network.contractsFile} (gitignored)`);
