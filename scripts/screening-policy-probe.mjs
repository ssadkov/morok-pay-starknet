/**
 * Is `get_open_note_screening_policy` deployed on the STRK20 pool yet?
 *
 * docs/relayed-submission.md flags a version risk: `main` adds
 * `open_note_depositor_screening_policies`, a per-contract map whose default
 * (`Required`) would block MorokEscrow / a DonationPot from crediting an open
 * note until StarkWare sets a policy for that contract address. The vendored
 * RC.5 SDK has no such map in its ABI, and which version is actually deployed
 * was never confirmed on chain - this is that confirmation, step 2 from the
 * doc's "Not yet verified on chain" list.
 *
 * `get_open_note_screening_policy` exists only on the newer pool, so an
 * "entry point not found" response on the *current* pool is itself the
 * answer: the old pool contract, whatever the RC.6 proof-interceptor
 * announcement means for the prover side. A different failure (e.g. a
 * calldata/deserialization error) would mean the entrypoint exists but this
 * script guessed its signature wrong - worth a closer look, not a "no".
 *
 * Read-only. No account, no signing, no spend.
 *
 * Usage:
 *   node scripts/screening-policy-probe.mjs             # both networks
 *   node scripts/screening-policy-probe.mjs mainnet
 *   node scripts/screening-policy-probe.mjs sepolia
 */

import { RpcProvider } from "starknet";

import { resolveNetwork } from "./lib/networks.mjs";

const ENTRYPOINT = "get_open_note_screening_policy";

const requested = process.argv[2];
const targets = requested ? [requested] : ["mainnet", "sepolia"];

for (const name of targets) {
  const network = resolveNetwork(name);
  const provider = new RpcProvider({ nodeUrl: network.rpc });

  console.log(`\n[${name}] pool ${network.pool}`);
  console.log(`  rpc: ${network.rpc}`);

  /* Signature is not documented anywhere reachable from this repo (not in
     the vendored RC.5 ABI, not in any local Cairo source). Guess the pool
     itself as the "which contract's open-note policy" argument - if the
     entrypoint exists but expects something else, the error below will say
     so rather than "not found". */
  const attempts = [
    { label: "no args", calldata: [] },
    { label: "pool address as arg", calldata: [network.pool] },
  ];

  for (const { label, calldata } of attempts) {
    try {
      const result = await provider.callContract({
        contractAddress: network.pool,
        entrypoint: ENTRYPOINT,
        calldata,
      });
      console.log(`  [${label}] OK -> ${JSON.stringify(result)}`);
    } catch (error) {
      const message = error?.message ?? String(error);
      const notFound =
        /entry ?point.*not found|entrypoint does not exist|invalid message selector/i.test(
          message,
        );
      console.log(
        `  [${label}] ${notFound ? "ENTRY POINT NOT FOUND (old pool - no screening-policy map)" : "ERROR"}`,
      );
      if (!notFound) {
        console.log(`    ${message}`);
      }
    }
  }
}
