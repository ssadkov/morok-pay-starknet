/**
 * Follow-up to probe 1: which contract is the STRK20 entry point on mainnet.
 *
 * Real pool transactions call 0x1270..., while events surface from the address
 * we keep in lib/starknet/constants.ts. MorokInvoices must assert its caller is
 * whichever contract actually performs the privacy_invoke, so confirm both.
 *
 * Usage: node scripts/probe-pool-address.mjs <txHash>
 */

const RPC = process.env.STARKNET_RPC_URL ?? "https://rpc.starknet.lava.build";
const HASH =
  process.argv[2] ??
  "0x60f1bbf8ea6a81d135c28395ba8367fd534cf7dde1613e9942a9493eb8e66a9";

let id = 0;

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const receipt = await rpc("starknet_getTransactionReceipt", [HASH]);
const emitters = new Map();
for (const event of receipt.events ?? []) {
  const key = event.from_address;
  emitters.set(key, (emitters.get(key) ?? 0) + 1);
}

console.log(`events in ${HASH}:`);
for (const [address, count] of emitters) {
  const classHash = await rpc("starknet_getClassHashAt", ["latest", address]);
  console.log(`  ${address}  events=${count}  class=${classHash}`);
}
