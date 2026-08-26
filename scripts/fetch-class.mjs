/**
 * Pulls a declared class off one network so it can be declared on another.
 *
 * The Eth712 account and its factory are built from
 * `starkware-libs/starkware-starknet-utils`, which needs Scarb and a Cairo
 * toolchain this machine does not have. It does not need one: the classes are
 * already declared on Sepolia, and an RPC can hand back both halves of a
 * declaration - `starknet_getClass` for the Sierra and
 * `starknet_getCompiledCasm` for the CASM.
 *
 * Re-declaring the exact bytes is also safer than rebuilding. The class hash is
 * a hash of the compiled class, and every account address derives from a
 * hard-coded `PRIMER_CLASS_HASH`, so a rebuild that shifts a hash by one
 * compiler version silently changes addresses. This script verifies the
 * round-trip: the Sierra it writes must hash back to the class hash asked for.
 *
 * Usage:
 *   node scripts/fetch-class.mjs 0x7c484... [sepolia]
 *
 * Writes .secrets/classes/<class_hash>.{sierra,casm}.json - gitignored, because
 * these are large and belong to the build, not the repository.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { hash } from "starknet";

import { resolveNetwork } from "./lib/networks.mjs";

const CLASS_HASH = process.argv[2];
const network = resolveNetwork(process.argv[3] ?? "sepolia");

if (!CLASS_HASH?.startsWith("0x")) {
  console.error("Usage: node scripts/fetch-class.mjs <class_hash> [network]");
  process.exit(1);
}

async function rpc(method, params) {
  const res = await fetch(network.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) {
    throw new Error(`${method}: ${body.error.message} ${body.error.data ?? ""}`);
  }
  return body.result;
}

console.log(`Reading ${CLASS_HASH} from ${network.name}`);

const sierra = await rpc("starknet_getClass", {
  block_id: "latest",
  class_hash: CLASS_HASH,
});
const casm = await rpc("starknet_getCompiledCasm", { class_hash: CLASS_HASH });

/* The ABI arrives as a JSON string over the wire. starknet.js does its own
   canonical serialization when hashing, so it wants the parsed array - hand it
   the string and the class hashes to something else entirely. */
if (typeof sierra.abi === "string") sierra.abi = JSON.parse(sierra.abi);

const recomputed = hash.computeContractClassHash(sierra);
if (BigInt(recomputed) !== BigInt(CLASS_HASH)) {
  console.error(
    `Round-trip failed: the Sierra returned hashes to ${recomputed}, not ${CLASS_HASH}.\n` +
      `Declaring it would create a different class. Stopping.`,
  );
  process.exit(1);
}
console.log(`  sierra OK - rehashes to the same class hash`);
console.log(`  sierra_program ${sierra.sierra_program.length} felts`);

const compiledClassHash = hash.computeCompiledClassHash(casm);
console.log(`  casm bytecode ${casm.bytecode.length} felts`);
console.log(`  compiled class hash ${compiledClassHash}`);

mkdirSync(".secrets/classes", { recursive: true });
const base = `.secrets/classes/${CLASS_HASH}`;
writeFileSync(`${base}.sierra.json`, JSON.stringify(sierra));
writeFileSync(`${base}.casm.json`, JSON.stringify(casm));
console.log(`  written to ${base}.{sierra,casm}.json`);
