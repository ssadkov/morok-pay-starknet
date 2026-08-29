/**
 * Reads a mainnet STRK20 transaction and answers one question directly:
 * does its calldata name a pool participant in plaintext?
 *
 * The premise is the same one `namesRecipient` in lib/privacy/relay-client.ts
 * uses, but applied to somebody else's finished transaction instead of a call
 * we are about to send. A channel-opening transfer carries the recipient's
 * address as an ordinary felt in `apply_actions` calldata; every later
 * transfer through that channel does not. So: walk the felts, keep the ones
 * that could be an address, and ask the pool `get_public_key` about each. A
 * nonzero answer means that felt is a registered STRK20 account sitting in
 * public calldata - not a proof word that happens to look like an address.
 *
 * Prints, per transaction: who submitted it (the wallet itself, or somebody
 * sponsoring it), which entrypoints it called, and every registered address
 * found in the clear.
 *
 * Usage:
 *   node scripts/calldata-leak-probe.mjs <txHash> [txHash...]
 *   node scripts/calldata-leak-probe.mjs --file hashes.txt
 *
 * Set PROBE_RPC_URL and PROBE_POOL_ADDRESS to point it at Sepolia.
 */

import { readFile } from "node:fs/promises";
import { hash } from "starknet";

const RPC = process.env.PROBE_RPC_URL ?? "https://rpc.starknet.lava.build";
const POOL =
  process.env.PROBE_POOL_ADDRESS ??
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

const KNOWN_ENTRYPOINTS = [
  "apply_actions",
  "transfer",
  "approve",
  "__execute__",
  "get_public_key",
  "deposit",
  "register",
];
const SELECTORS = new Map(
  KNOWN_ENTRYPOINTS.map((name) => [BigInt(hash.getSelectorFromName(name)), name]),
);

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const norm = (felt) => `0x${BigInt(felt).toString(16).padStart(64, "0")}`;

/** Splits an account's `__execute__` calldata into its individual calls. */
function parseCalls(calldata) {
  const felts = calldata.map((f) => BigInt(f));
  const calls = [];
  let i = 0;
  const count = Number(felts[i++]);
  if (!Number.isSafeInteger(count) || count < 1 || count > 32) return null;
  for (let c = 0; c < count; c++) {
    if (i + 3 > felts.length) return null;
    const to = felts[i++];
    const selector = felts[i++];
    const len = Number(felts[i++]);
    if (!Number.isSafeInteger(len) || i + len > felts.length) return null;
    calls.push({ to, selector, data: felts.slice(i, i + len) });
    i += len;
  }
  return i === felts.length ? calls : null;
}

const registrationCache = new Map();
async function registeredPublicKey(address) {
  const key = norm(address);
  if (registrationCache.has(key)) return registrationCache.get(key);
  let answer = null;
  try {
    const result = await rpc("starknet_call", [
      { contract_address: POOL, entry_point_selector: hash.getSelectorFromName("get_public_key"), calldata: [key] },
      "latest",
    ]);
    const value = Array.isArray(result) ? result[0] : result?.result?.[0];
    answer = value && BigInt(value) !== 0n ? norm(value) : null;
  } catch {
    answer = null;
  }
  registrationCache.set(key, answer);
  return answer;
}

/** Felts that could be a Starknet address at all - the rest cannot be one. */
function addressCandidates(felts) {
  const seen = new Set();
  const out = [];
  for (const felt of felts) {
    if (felt < 1n << 200n) continue; // too small to be a real account address
    if (felt >= 1n << 251n) continue; // beyond the address space
    const key = norm(felt);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(felt);
  }
  return out;
}

async function probe(txHash) {
  const tx = await rpc("starknet_getTransactionByHash", [txHash]);
  const receipt = await rpc("starknet_getTransactionReceipt", [txHash]);
  const sender = tx.sender_address ?? tx.contract_address ?? null;

  const calls = tx.calldata ? parseCalls(tx.calldata) : null;
  const entrypoints = (calls ?? []).map((call) => ({
    to: norm(call.to),
    entrypoint: SELECTORS.get(call.selector) ?? norm(call.selector),
    feltCount: call.data.length,
    isPool: norm(call.to) === POOL,
  }));

  const felts = (calls ?? []).flatMap((call) => call.data);
  const named = [];
  for (const candidate of addressCandidates(felts)) {
    const publicKey = await registeredPublicKey(candidate);
    if (publicKey) named.push({ address: norm(candidate), publicKey });
  }

  const senderNormalized = sender ? norm(sender) : null;
  const senderRegistered = sender ? await registeredPublicKey(sender) : null;

  return {
    txHash,
    type: tx.type,
    status: `${receipt.finality_status ?? "?"}/${receipt.execution_status ?? "?"}`,
    sender: senderNormalized,
    senderRegisteredInPool: Boolean(senderRegistered),
    calls: entrypoints,
    registeredAddressesInCalldata: named,
    parsed: calls !== null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  let hashes = args;
  if (args[0] === "--file") {
    const text = await readFile(args[1], "utf8");
    hashes = text.split(/\s+/).filter((line) => line.startsWith("0x"));
  }
  if (!hashes.length) {
    throw new Error("Usage: node scripts/calldata-leak-probe.mjs <txHash> [txHash...]");
  }
  const results = [];
  for (const txHash of hashes) {
    try {
      results.push(await probe(txHash));
    } catch (error) {
      results.push({ txHash, error: error instanceof Error ? error.message : String(error) });
    }
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
