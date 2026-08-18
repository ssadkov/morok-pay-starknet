/**
 * Decode EchoHelper.Invoked from a Sepolia transaction.
 *
 * Usage: node scripts/probe-echo-caller.mjs <txHash>
 */

import { hash, RpcProvider } from "starknet";

const RPC =
  process.env.STARKNET_SEPOLIA_RPC_URL ??
  "https://api.cartridge.gg/x/starknet/sepolia";
const ECHO =
  process.env.ECHO_HELPER ??
  "0x012ec63321392b74063bafa1fb27804b84ba35482a1310f01d3510962b093a03";
const HASH = process.argv[2];
if (!HASH) {
  throw new Error("Usage: node scripts/probe-echo-caller.mjs <txHash>");
}

const INVOKED = hash.getSelectorFromName("Invoked");
const provider = new RpcProvider({ nodeUrl: RPC });
const receipt = await provider.getTransactionReceipt(HASH);
const events = ("events" in receipt ? receipt.events : []) ?? [];
const hits = events.filter(
  (event) =>
    BigInt(event.from_address) === BigInt(ECHO) &&
    event.keys?.[0] &&
    BigInt(event.keys[0]) === BigInt(INVOKED),
);

console.log(`echo helper ${ECHO}`);
console.log(`tx ${HASH} events=${events.length} invoked=${hits.length}`);
for (const event of hits) {
  const caller = event.keys[1] ?? event.data?.[0];
  console.log(`caller ${caller}`);
}
if (hits.length === 0) {
  console.log("no Invoked event — Ready may have dropped the invoke, or the pool reverted it");
}
