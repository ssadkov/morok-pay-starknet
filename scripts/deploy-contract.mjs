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

import { resolveNetwork, STRK } from "./lib/networks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = process.argv[2] ?? "escrow";
const network = resolveNetwork(process.argv.find((item, index) => index > 2 && !item.startsWith("--")));
const SUBMIT = process.argv.includes("--submit");

/* Minimums are per token because one number cannot serve both: USDC has six
   decimals and STRK eighteen. A token left out has no floor, which defeats the
   floor's purpose - the sponsored account deploy is granted on any funded
   unclaimed entry, whatever the token - so list every token the app accepts. */
const MINIMUMS = [
  [network.usdc, 1_000_000n],                    // 1 USDC
  [STRK, 5n * 10n ** 18n],                       // 5 STRK
];

const CONTRACTS = {
  escrow: {
    name: "MorokEscrow",
    sierra: "morok_pay_MorokEscrow.contract_class.json",
    casm: "morok_pay_MorokEscrow.compiled_contract_class.json",
    constructor: [network.pool],
  },
  escrowV2: {
    name: "MorokEscrowV2",
    sierra: "morok_pay_MorokEscrowV2.contract_class.json",
    casm: "morok_pay_MorokEscrowV2.compiled_contract_class.json",
    constructor: [
      network.pool,
      MINIMUMS.length,
      ...MINIMUMS.flatMap(([token, minimum]) => [token, minimum.toString()]),
    ],
  },
};

const spec = CONTRACTS[TARGET];
if (!spec) {
  throw new Error(`Unknown target "${TARGET}". Use escrow or escrowV2.`);
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

const [balanceLow, balanceHigh] = await provider.callContract({
  contractAddress: STRK,
  entrypoint: "balance_of",
  calldata: [deployer.address],
});
const balance = BigInt(balanceLow) + (BigInt(balanceHigh ?? "0x0") << BigInt(128));
const asStrk = (value) => `${(Number(value) / 1e18).toFixed(4)} STRK`;
console.log(`deployer holds ${asStrk(balance)}`);

const payload = {
  contract: sierra,
  casm,
  constructorCalldata: CallData.compile(spec.constructor),
};

/* Estimating first is cheap and answers the only question that matters before
   a mainnet declare: whether this account can actually pay for it. */
let estimated = null;
try {
  const fees = await account.estimateDeclareFee({ contract: sierra, casm });
  estimated = fees.overall_fee;
  console.log(`declare fee ~${asStrk(estimated)} (deploy is charged on top)`);
} catch (error) {
  const reason = String(error?.message ?? error).split(/\r?\n/)[0];
  console.log(`declare fee could not be estimated: ${reason}`);
}

if (SUBMIT) {
  if (estimated !== null && balance < estimated) {
    throw new Error(
      `Deployer holds ${asStrk(balance)}, below the ~${asStrk(estimated)} declare alone would cost.`,
    );
  }
} else {
  console.log(`
Dry run - nothing was submitted.${
    network.name === "mainnet"
      ? " Add --submit to spend real STRK."
      : " Add --submit to declare and deploy."
  }`);
  process.exit(0);
}

const result = await account.declareAndDeploy(payload);

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
