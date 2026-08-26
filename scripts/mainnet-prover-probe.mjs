/**
 * Stage A - does the mainnet STRK20 proving service work for us?
 *
 * The MetaMask path needs a mainnet prover, and the sprint chat only ever
 * offered Sepolia proving URLs. Before spending a day declaring an account
 * class and deploying a factory on mainnet, this asks the cheaper question
 * first: given an ordinary Starknet account, will the mainnet prover return a
 * real proof for a pool operation?
 *
 * It needs neither the Eth712 account class, the factory, nor MetaMask. The
 * pool verifies an OR-fallback - `is_valid_signature(compute_call_set_hash())`
 * - so a plain SRC6 account signing a SNIP-12 CallSet is a first-class
 * depositor. That is what `Snip12CallSetSigner` exists for ("Legacy SN
 * wallets, e.g. Fordefi").
 *
 * By default nothing is submitted and nothing is spent: proving happens off
 * chain, so a returned PROOF1 proof already answers the question. `--submit`
 * is a separate, deliberate step that costs the pool fee plus gas.
 *
 * Usage:
 *   MOROK_VIEWING_PASSPHRASE=... node scripts/mainnet-prover-probe.mjs
 *   MOROK_VIEWING_PASSPHRASE=... node scripts/mainnet-prover-probe.mjs --submit
 *   ... --role payout        // another account in .secrets/mainnet-accounts.json
 *
 * The passphrase is the viewing key. Losing it loses the ability to discover
 * this account's notes, and anyone who learns it can read its private
 * balances. Store it as carefully as the account key.
 */

import { readFileSync } from "node:fs";
import { Account, RpcProvider, cairo, constants, ec, num } from "starknet";
import {
  createPrivateTransfers,
  SetupRequirement,
} from "@starkware-libs/starknet-privacy-sdk";
import { passphraseViewingKeyProvider } from "@starkware-libs/starknet-privacy-client";
import { Snip12CallSetSigner } from "@starkware-libs/starknet-privacy-client/signers";

import { resolveNetwork, STRK } from "./lib/networks.mjs";

const PROVER_URL = "https://transaction-prover.alpha-mainnet.sw-dev.io";
const DISCOVERY_URL = "https://discovery-service.alpha-mainnet.sw-dev.io";

/* The privacy flow needs an RPC that keeps `proof_facts` through fee
   estimation. Cartridge's Sepolia default reported 0.9.0 and dropped them,
   which cost an afternoon; refuse anything older than 0.10.1 here too. */
const PRIVACY_RPC_URL =
  process.env.STARKNET_PRIVACY_MAINNET_RPC_URL ??
  "https://api.zan.top/public/starknet-mainnet/rpc/v0_10";
const MIN_RPC_SPEC = [0, 10, 1];

/* The proof is built against a block behind the head, so the final
   transaction cannot be assembled against the block it proves. */
const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = BigInt("0x50524f4f4631");

/* A signed resource bound is a ceiling, not a charge - but it is the number a
   bug could spend. Cap it independently of what the account holds. */
const MAXIMUM_GAS_FEE = BigInt(12) * BigInt(10) ** BigInt(18);

const SUBMIT = process.argv.includes("--submit");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ROLE = argValue("--role") ?? "deployer";

function strk(value) {
  return `${(Number(value) / 1e18).toFixed(6)} STRK`;
}

function step(n, text) {
  console.log(`\n[${n}] ${text}`);
}

function compareSpec(a, b) {
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

async function jsonRpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

const passphrase = process.env.MOROK_VIEWING_PASSPHRASE;
if (!passphrase) {
  console.error(
    "MOROK_VIEWING_PASSPHRASE is not set. It derives the viewing key; pick one and keep it.",
  );
  process.exit(1);
}

const network = resolveNetwork("mainnet");
const store = JSON.parse(readFileSync(network.accountsFile, "utf8"));
const entry = store.accounts.find((item) => item.role === ROLE);
if (!entry) {
  throw new Error(`No account with role "${ROLE}" in ${network.accountsFile}`);
}

const address = entry.address;
console.log("MorokPay mainnet prover probe");
console.log(`  account : ${address} (role ${ROLE})`);
console.log(`  pool    : ${network.pool}`);
console.log(`  prover  : ${PROVER_URL}`);
console.log(
  `  mode    : ${SUBMIT ? "SUBMIT - this spends real STRK" : "dry run - nothing is sent"}`,
);

/* ------------------------------------------------------------------ *
 * 1. Are the mainnet services there and answering?
 * ------------------------------------------------------------------ */
step(1, "Mainnet privacy services");

const health = await fetch(`${DISCOVERY_URL}/health`).then((r) => r.json());
if (health.status !== "OK") {
  throw new Error(`Discovery is not OK: ${JSON.stringify(health)}`);
}
console.log(
  `  discovery OK - chain head ${health.chain_head?.block_number}, lag ${health.lag_secs}s`,
);

const proverPing = await jsonRpc(PROVER_URL, "starknet_proveTransaction", {});
if (proverPing.error?.code !== -32602) {
  throw new Error(
    `Prover did not answer as a JSON-RPC service: ${JSON.stringify(proverPing)}`,
  );
}
console.log(
  `  prover reachable, no auth - rejects an empty request with "${proverPing.error.data}"`,
);

const provider = new RpcProvider({
  nodeUrl: PRIVACY_RPC_URL,
  specVersion: "0.10.3",
});
const spec = await provider.getSpecVersion();
const parsedSpec = spec.split("-")[0].split(".").map(Number);
if (parsedSpec.some(Number.isNaN) || compareSpec(parsedSpec, MIN_RPC_SPEC) < 0) {
  throw new Error(
    `RPC reports spec ${spec}; 0.10.1+ is required or proof facts are dropped.`,
  );
}
console.log(`  rpc spec ${spec}`);

/* ------------------------------------------------------------------ *
 * 2. Is this account usable - deployed, funded, not already registered?
 * ------------------------------------------------------------------ */
step(2, "Account and pool state");

const classHash = await provider.getClassHashAt(address).catch(() => null);
if (!classHash) {
  throw new Error(`${address} is not deployed on mainnet. Deploy it first.`);
}
console.log(`  deployed, class ${classHash}`);

const [balanceLow = "0x0"] = await provider.callContract({
  contractAddress: STRK,
  entrypoint: "balance_of",
  calldata: [address],
});
const balance = BigInt(balanceLow);

const [feeLow = "0x0", feeHigh = "0x0"] = await provider.callContract({
  contractAddress: network.pool,
  entrypoint: "get_fee_amount",
  calldata: [],
});
const poolFee = BigInt(feeLow) + (BigInt(feeHigh) << BigInt(128));
console.log(`  public balance ${strk(balance)}, pool fee ${strk(poolFee)}`);

const [registered = "0x0"] = await provider.callContract({
  contractAddress: network.pool,
  entrypoint: "get_public_key",
  calldata: [address],
});
console.log(
  `  pool get_public_key: ${BigInt(registered) === BigInt(0) ? "not registered" : registered}`,
);

/* ------------------------------------------------------------------ *
 * 3. SDK against mainnet, signing with the account's own stark key.
 * ------------------------------------------------------------------ */
step(3, "Privacy SDK on SN_MAIN");

const chainId = constants.StarknetChainId.SN_MAIN;
const callSetSigner = new Snip12CallSetSigner({
  accountAddress: address,
  chainId,
  sign: (messageHash) =>
    ec.starkCurve.sign(num.toHex(messageHash), entry.privateKey),
});

const transfers = createPrivateTransfers({
  account: { address, signer: callSetSigner },
  viewingKeyProvider: passphraseViewingKeyProvider(passphrase, address),
  provingProvider: {
    url: PROVER_URL,
    chainId,
    nodeUrl: PRIVACY_RPC_URL,
    ohttp: true,
  },
  discoveryProvider: { url: DISCOVERY_URL },
  poolContractAddress: network.pool,
});
console.log("  SNIP-12 CallSet signer wired to the account key");

/* Already a real round trip to mainnet discovery with a real viewing key,
   and it costs nothing. */
const requirement = await transfers.discoverRequirement(address, STRK);
console.log(
  `  discoverRequirement(STRK) -> ${SetupRequirement[requirement] ?? requirement}`,
);
if (requirement !== SetupRequirement.Register) {
  console.log("  Already past registration. Use a fresh account to test this.");
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 * 4. The actual question: will the mainnet prover produce a proof?
 * ------------------------------------------------------------------ */
step(4, "Requesting a registration proof from the mainnet prover");

const head = await provider.getBlockNumber();
const provingBlock = head - PROVING_BLOCK_DEPTH;
console.log(`  head ${head}, proving against ${provingBlock}`);

const started = Date.now();
const invocation = await transfers
  .build()
  .register()
  .createProofInvocation({ provingBlockId: provingBlock });
const result = await transfers.executeWithInvocation(invocation, provingBlock);
const { callAndProof } = result;
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

if (!callAndProof.proof.proofFacts.length) {
  throw new Error("The prover returned no proof facts. Do not submit this.");
}
if (BigInt(callAndProof.proof.proofFacts[0]) !== PROOF1_VERSION) {
  throw new Error(
    `Unsupported proof version ${callAndProof.proof.proofFacts[0]}; expected PROOF1.`,
  );
}

console.log(`  proof returned in ${elapsed}s`);
console.log(
  `  ${callAndProof.proof.data.length} felts, ${callAndProof.proof.proofFacts.length} proof facts, version PROOF1`,
);
console.log("\n  ==> The mainnet proving service works for a non-Ready account.");

if (!SUBMIT) {
  console.log(
    "\nDry run only. Nothing was submitted and nothing was spent.\n" +
      `Re-run with --submit to register on mainnet (${strk(poolFee)} pool fee plus gas).`,
  );
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 * 5. Submit - real money from here down.
 * ------------------------------------------------------------------ */
step(5, "Submitting the registration on mainnet");

if (balance < poolFee) {
  throw new Error(
    `Account holds ${strk(balance)} but the pool fee alone is ${strk(poolFee)}. Fund it first.`,
  );
}

const account = new Account({
  provider,
  address,
  signer: entry.privateKey,
  cairoVersion: "1",
});
const fee = cairo.uint256(poolFee);
const calls = [
  {
    contractAddress: STRK,
    entrypoint: "approve",
    calldata: [network.pool, fee.low.toString(), fee.high.toString()],
  },
  callAndProof.call,
];
const proofDetails = {
  proof: callAndProof.proof.data,
  proofFacts: callAndProof.proof.proofFacts,
};

const nonce = BigInt(await account.getNonce());
const estimate = await account.estimateInvokeFee(calls, {
  nonce,
  skipValidate: true,
  tip: BigInt(0),
  ...proofDetails,
});

const bounds = estimate.resourceBounds;
const ceiling =
  BigInt(bounds.l1_gas.max_amount) * BigInt(bounds.l1_gas.max_price_per_unit) +
  BigInt(bounds.l2_gas.max_amount) * BigInt(bounds.l2_gas.max_price_per_unit) +
  BigInt(bounds.l1_data_gas.max_amount) *
    BigInt(bounds.l1_data_gas.max_price_per_unit);
console.log(`  estimated ceiling ${strk(ceiling)} (cap ${strk(MAXIMUM_GAS_FEE)})`);
if (ceiling > MAXIMUM_GAS_FEE) {
  throw new Error("Estimated ceiling exceeds the cap. Refusing to sign.");
}
if (balance < poolFee + ceiling) {
  throw new Error(
    `Account holds ${strk(balance)}; fee plus gas ceiling is ${strk(poolFee + ceiling)}.`,
  );
}

const submission = await account.execute(calls, {
  nonce,
  resourceBounds: bounds,
  tip: BigInt(0),
  ...proofDetails,
});
console.log(`  submitted ${submission.transaction_hash}`);
console.log(`  ${network.explorer}/tx/${submission.transaction_hash}`);

const receipt = await provider.waitForTransaction(submission.transaction_hash);
console.log(`  execution status: ${receipt.execution_status ?? "see explorer"}`);

const [after = "0x0"] = await provider.callContract({
  contractAddress: network.pool,
  entrypoint: "get_public_key",
  calldata: [address],
});
console.log(`  pool get_public_key after: ${after}`);
console.log(
  BigInt(after) === BigInt(0)
    ? "\n  Registration did not take. Read the receipt before retrying."
    : "\n  Registered on mainnet. Add this hash to strk20.json.",
);
