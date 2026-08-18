/**
 * Probe 1 from docs/private-invoices.md: who signs a STRK20 pool transaction.
 *
 * Reads recent pool events on mainnet, then reports the sender_address of the
 * transactions that produced them. Distinct senders mean the buyer's own
 * account signs, so their address is public on every private payment. A single
 * repeated sender would mean Ready relays and the buyer stays hidden.
 *
 * Usage: node scripts/probe-pool-sender.mjs [blockWindow]
 */

const RPC = process.env.STARKNET_RPC_URL ?? "https://rpc.starknet.lava.build";
const POOL =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const WINDOW = Number(process.argv[2] ?? 40_000);

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

const head = await rpc("starknet_blockNumber", []);
const hashes = new Set();
let continuation;

do {
  const page = await rpc("starknet_getEvents", [
    {
      from_block: { block_number: Math.max(0, head - WINDOW) },
      to_block: "latest",
      address: POOL,
      chunk_size: 100,
      ...(continuation ? { continuation_token: continuation } : {}),
    },
  ]);
  for (const event of page.events) hashes.add(event.transaction_hash);
  continuation = page.continuation_token;
} while (continuation && hashes.size < 40);

console.log(`blocks scanned: ${WINDOW}, unique pool txs: ${hashes.size}`);

const senders = new Map();

for (const hash of hashes) {
  const tx = await rpc("starknet_getTransactionByHash", [hash]);
  const sender = tx.sender_address;
  senders.set(sender, (senders.get(sender) ?? 0) + 1);
}

console.log(`distinct senders: ${senders.size}`);
for (const [sender, count] of senders) console.log(`  ${sender}  x${count}`);

const [first] = hashes;
const tx = await rpc("starknet_getTransactionByHash", [first]);
const callCount = Number(tx.calldata?.[0] ?? 0);
console.log(`\nsample tx ${first}`);
console.log(`  sender: ${tx.sender_address}`);
console.log(`  calls in this invoke: ${callCount}`);
let cursor = 1;
for (let i = 0; i < callCount; i += 1) {
  const to = tx.calldata[cursor];
  const selector = tx.calldata[cursor + 1];
  const length = Number(tx.calldata[cursor + 2] ?? 0);
  console.log(
    `  call ${i}: to=${to} selector=${selector} calldataLen=${length}` +
      (BigInt(to) === BigInt(POOL) ? "   <- privacy pool" : ""),
  );
  cursor += 3 + length;
}
