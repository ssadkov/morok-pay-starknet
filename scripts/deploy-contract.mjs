/**
 * Declares and deploys a compiled MorokPay helper on Starknet Sepolia.
 *
 * Usage:
 *   node scripts/deploy-contract.mjs echo
 *   node scripts/deploy-contract.mjs invoices
 *
 * Requires a funded deployer in .secrets/sepolia-accounts.json and
 * `scarb build` artifacts under contracts/target/dev.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, CallData, RpcProvider, json } from "starknet";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC =
  process.env.STARKNET_SEPOLIA_RPC_URL ??
  "https://api.cartridge.gg/x/starknet/sepolia";
const SEPOLIA_POOL =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const TARGET = process.argv[2] ?? "echo";

const CONTRACTS = {
  echo: {
    name: "EchoHelper",
    sierra: "morok_pay_EchoHelper.contract_class.json",
    casm: "morok_pay_EchoHelper.compiled_contract_class.json",
    constructor: [],
  },
  invoices: {
    name: "MorokInvoices",
    sierra: "morok_pay_MorokInvoices.contract_class.json",
    casm: "morok_pay_MorokInvoices.compiled_contract_class.json",
    constructor: [SEPOLIA_POOL],
  },
};

const spec = CONTRACTS[TARGET];
if (!spec) {
  throw new Error(`Unknown target "${TARGET}". Use echo or invoices.`);
}

const store = json.parse(
  readFileSync(join(ROOT, ".secrets", "sepolia-accounts.json"), "utf8"),
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

const provider = new RpcProvider({ nodeUrl: RPC });
const account = new Account({
  provider,
  address: deployer.address,
  signer: deployer.privateKey,
});

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

const outPath = join(ROOT, ".secrets", "sepolia-contracts.json");
mkdirSync(dirname(outPath), { recursive: true });
const previous = existsSync(outPath)
  ? json.parse(readFileSync(outPath, "utf8"))
  : { network: "sepolia" };
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      ...previous,
      network: "sepolia",
      pool: SEPOLIA_POOL,
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
console.log(`addresses written to ${outPath} (gitignored)`);
