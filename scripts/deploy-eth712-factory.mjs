/**
 * Puts the Eth712 account stack on mainnet: the account class, the factory
 * class, and one factory instance.
 *
 * This is the only thing still missing for the MetaMask entry path. Proving,
 * discovery, the RPC and the SDK wiring were all confirmed on mainnet by
 * scripts/mainnet-prover-probe.mjs; nothing here is exploratory.
 *
 * The classes are re-declared byte-for-byte from Sepolia rather than rebuilt -
 * see scripts/fetch-class.mjs for why. `PRIMER_CLASS_HASH` is hard-coded inside
 * the factory and is already declared on mainnet by StarkWare, so it is not
 * ours to deploy.
 *
 * An account address is
 *   pedersen(prefix, factory_address, eth_address, PRIMER_CLASS_HASH, [])
 * so it depends on the factory instance. A second factory means different
 * addresses for the same users - deploy once, then never again.
 *
 * Usage:
 *   node scripts/deploy-eth712-factory.mjs               // estimate only
 *   node scripts/deploy-eth712-factory.mjs --submit
 *
 * Each step is skipped when it is already on chain, so a rerun after a failure
 * costs only what is left to do.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Account, CallData, RpcProvider, hash } from "starknet";

import { resolveNetwork } from "./lib/networks.mjs";

/* The STRK20-compatible account: its CallSet validator takes the three
   arguments the pool passes, including `additional_data`. Pointing the factory
   straight at it is what removes the separate self-upgrade transaction that
   Sepolia needed. */
const ACCOUNT_CLASS =
  "0x0697437b25b81bcdd2d1b231d3b8670849fb318555903dbc2fefce2a1a35586e";
const FACTORY_CLASS =
  "0x7c484ef51dbbe60d9459bed6cab46d0004585847f4cc36398df4db81b036d52";
/* Cemented by StarkWare; every account address derives from it. */
const PRIMER_CLASS =
  "0x00123e6bc1c14ae9934e933d3f64916a6116dd6b036a922b2b1f0815e0d1d300";

const UPGRADE_DELAY = 0n;

/* Declaring these is expensive and the estimate is not padded: mainnet quoted
   73.67 STRK for the account class and 77.70 for the factory on 2026-08-26,
   almost entirely L2 gas for compiling a ~7,000-felt Sierra program. The cap
   is a guard against a bad quote, not a budget - it sits just above what two
   independent RPCs agreed on. */
const MAXIMUM_STEP_FEE = BigInt(100) * BigInt(10) ** BigInt(18);

const SUBMIT = process.argv.includes("--submit");
const ROLE = argValue("--role") ?? "deployer";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function strk(value) {
  return `${(Number(value) / 1e18).toFixed(6)} STRK`;
}

function ceilingOf(bounds) {
  return (
    BigInt(bounds.l1_gas.max_amount) * BigInt(bounds.l1_gas.max_price_per_unit) +
    BigInt(bounds.l2_gas.max_amount) * BigInt(bounds.l2_gas.max_price_per_unit) +
    BigInt(bounds.l1_data_gas.max_amount) *
      BigInt(bounds.l1_data_gas.max_price_per_unit)
  );
}

const network = resolveNetwork("mainnet");
const provider = new RpcProvider({ nodeUrl: network.rpc, specVersion: "0.10.3" });

const store = JSON.parse(readFileSync(network.accountsFile, "utf8"));
const entry = store.accounts.find((item) => item.role === ROLE);
if (!entry) throw new Error(`No account with role "${ROLE}"`);
const account = new Account({
  provider,
  address: entry.address,
  signer: entry.privateKey,
  cairoVersion: "1",
});

const deployments = existsSync(network.contractsFile)
  ? JSON.parse(readFileSync(network.contractsFile, "utf8"))
  : {};

function record(key, value) {
  deployments[key] = value;
  writeFileSync(network.contractsFile, `${JSON.stringify(deployments, null, 2)}\n`);
}

console.log("Eth712 account stack -> Starknet mainnet");
console.log(`  deployer : ${entry.address}`);
console.log(`  mode     : ${SUBMIT ? "SUBMIT - spends real STRK" : "estimate only"}`);

async function isDeclared(classHash) {
  try {
    await provider.getClass(classHash);
    return true;
  } catch {
    return false;
  }
}

function loadClass(classHash) {
  const base = `.secrets/classes/${classHash}`;
  if (!existsSync(`${base}.sierra.json`)) {
    throw new Error(
      `Missing ${base}.sierra.json - run: node scripts/fetch-class.mjs ${classHash} sepolia`,
    );
  }
  return {
    contract: JSON.parse(readFileSync(`${base}.sierra.json`, "utf8")),
    casm: JSON.parse(readFileSync(`${base}.casm.json`, "utf8")),
  };
}

let spent = 0n;

async function declareStep(label, classHash) {
  console.log(`\n[declare] ${label}`);
  console.log(`  class ${classHash}`);
  if (await isDeclared(classHash)) {
    console.log("  already declared on mainnet - skipping");
    return;
  }
  const payload = loadClass(classHash);
  const compiled = hash.computeCompiledClassHash(payload.casm);
  const rehashed = hash.computeContractClassHash(payload.contract);
  if (BigInt(rehashed) !== BigInt(classHash)) {
    throw new Error(`Local Sierra hashes to ${rehashed}, refusing to declare it.`);
  }
  console.log(`  compiled class hash ${compiled}`);

  const estimate = await account.estimateDeclareFee(payload);
  const ceiling = ceilingOf(estimate.resourceBounds);
  console.log(`  estimated ceiling ${strk(ceiling)}`);
  if (ceiling > MAXIMUM_STEP_FEE) {
    throw new Error(`Ceiling above the ${strk(MAXIMUM_STEP_FEE)} cap. Refusing to sign.`);
  }
  if (!SUBMIT) return;

  const sent = await account.declare(payload, { resourceBounds: estimate.resourceBounds });
  console.log(`  tx ${sent.transaction_hash}`);
  const receipt = await provider.waitForTransaction(sent.transaction_hash);
  const paid = BigInt(receipt.actual_fee?.amount ?? "0x0");
  spent += paid;
  console.log(`  ${receipt.execution_status ?? "done"}, paid ${strk(paid)}`);
  record(`${label}ClassTx`, sent.transaction_hash);
}

await declareStep("eth712Account", ACCOUNT_CLASS);
await declareStep("accountFactory", FACTORY_CLASS);

/* ------------------------------------------------------------------ *
 * The factory instance.
 * ------------------------------------------------------------------ */
console.log("\n[deploy] AccountFactory instance");

if (deployments.accountFactory) {
  console.log(`  already deployed at ${deployments.accountFactory} - skipping`);
} else if (!SUBMIT || !(await isDeclared(FACTORY_CLASS))) {
  console.log(
    !SUBMIT
      ? "  estimate mode - the factory class is not on chain yet, so its deploy cannot be estimated"
      : "  factory class is not declared; rerun after the declare confirms",
  );
} else {
  const constructorCalldata = CallData.compile({
    governance_admin: entry.address,
    upgrade_delay: UPGRADE_DELAY,
    account_class_hash: ACCOUNT_CLASS,
  });

  const estimate = await account.estimateDeployFee({
    classHash: FACTORY_CLASS,
    constructorCalldata,
  });
  const ceiling = ceilingOf(estimate.resourceBounds);
  console.log(`  estimated ceiling ${strk(ceiling)}`);
  if (ceiling > MAXIMUM_STEP_FEE) {
    throw new Error(`Ceiling above the ${strk(MAXIMUM_STEP_FEE)} cap. Refusing to sign.`);
  }

  const sent = await account.deployContract(
    { classHash: FACTORY_CLASS, constructorCalldata },
    { resourceBounds: estimate.resourceBounds },
  );
  console.log(`  tx ${sent.transaction_hash}`);
  const receipt = await provider.waitForTransaction(sent.transaction_hash);
  spent += BigInt(receipt.actual_fee?.amount ?? "0x0");
  console.log(`  ${receipt.execution_status ?? "done"}`);
  console.log(`  factory at ${sent.contract_address}`);
  record("accountFactory", sent.contract_address);
  record("accountFactoryTx", sent.transaction_hash);
}

/* ------------------------------------------------------------------ *
 * Read the factory back rather than trusting the deploy.
 * ------------------------------------------------------------------ */
if (deployments.accountFactory) {
  console.log("\n[verify] reading the factory back");
  const [configured] = await provider.callContract({
    contractAddress: deployments.accountFactory,
    entrypoint: "account_class_hash",
    calldata: [],
  });
  const matches = BigInt(configured) === BigInt(ACCOUNT_CLASS);
  console.log(`  account_class_hash: ${configured} ${matches ? "(expected)" : "(WRONG)"}`);

  /* A known EVM address, only to prove the derivation answers. */
  const sample = "0x70d5d723ba7f39cfb676c67bbd4b5d6ae8047f4b";
  const [expected] = await provider.callContract({
    contractAddress: deployments.accountFactory,
    entrypoint: "get_expected_account_address",
    calldata: [sample],
  });
  console.log(`  ${sample} -> ${expected}`);
  console.log(`  primer (hard-coded in the class): ${PRIMER_CLASS}`);
  if (!matches) {
    console.log(
      "\n  The factory points at the wrong account class. set_account_class_hash is app-governor gated.",
    );
  }
}

if (SUBMIT) console.log(`\nSpent this run: ${strk(spent)}`);
else console.log("\nEstimate only. Nothing was submitted. Add --submit to run it.");
