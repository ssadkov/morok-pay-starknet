/**
 * Does MorokEscrowV2 actually enforce what it claims to?
 *
 * V2 replaced V1's "know the secret" rule with `get_caller_address() == owner`,
 * added an expiry, a refund, a per-token minimum and an opt-in index. None of
 * that was exercised before deployment: snforge has no Windows binary and
 * `scarb cairo-test` cannot deploy a contract, so the only verification after
 * the Sepolia deploy was reading the constructor back. This is the rest.
 *
 * Six things, in one run:
 *
 *   1. a deposit through the pool records owner, refund_owner and expiry
 *   2. the opt-in index lists the commitment under the owner
 *   3. a stranger cannot claim                    -> CALLER_NOT_OWNER
 *   4. nobody can refund before the expiry        -> NOT_EXPIRED
 *   5. the owner can claim, to any destination
 *   6. after the expiry the refund_owner gets it back
 *
 * 5 and 6 need two entries, because an entry can only leave once.
 *
 * `spare` is the sender: it is the registered pool participant. `payout` owns
 * the first entry, `deployer` stands in for a stranger and for the refund
 * owner - ordinary accounts, deliberately, because what is under test is the
 * contract's rule rather than the EVM derivation that usually supplies the
 * owner. That half is already proven on mainnet.
 *
 * Usage:
 *   node scripts/escrow-v2-probe.mjs             # read-only
 *   node scripts/escrow-v2-probe.mjs --submit
 */

import { readFileSync } from "node:fs";
import {
  Account,
  RpcProvider,
  cairo,
  constants,
  ec,
  hash,
  num,
  shortString,
} from "starknet";
import { createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import { deriveViewingKey } from "@starkware-libs/starknet-privacy-client";
import { Snip12CallSetSigner } from "@starkware-libs/starknet-privacy-client/signers";

import { resolveNetwork, STRK } from "./lib/networks.mjs";

const SUBMIT = process.argv.includes("--submit");
const network = resolveNetwork("sepolia");

const PROVER_URL = `https://transaction-prover.alpha-${network.name}.sw-dev.io`;
const DISCOVERY_URL = `https://discovery-service.alpha-${network.name}.sw-dev.io`;
const PRIVACY_RPC_URL =
  process.env.STARKNET_PRIVACY_SEPOLIA_RPC_URL ??
  "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";
const CHAIN_ID = constants.StarknetChainId.SN_SEPOLIA;
const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = BigInt("0x50524f4f4631");
const ESCROW_V2_TAG = "MOROK_ESCROW:V2";
/* The contract's own floor for STRK is 5, so a smaller entry would be refused
   by the minimum rather than by whatever the step is testing. */
const PARK_AMOUNT = BigInt(5) * BigInt(10) ** BigInt(18);
/* Long enough that the claim test is not racing it, short enough that the
   refund test does not wait all afternoon. */
const EXPIRY_SECONDS = 180;

const provider = new RpcProvider({ nodeUrl: PRIVACY_RPC_URL, specVersion: "0.10.3" });
const reader = new RpcProvider({ nodeUrl: network.rpc });

const accounts = JSON.parse(readFileSync(network.accountsFile, "utf8"));
const contracts = JSON.parse(readFileSync(network.contractsFile, "utf8"));
const ESCROW = contracts.escrowV2?.address;
if (!ESCROW) throw new Error("No escrowV2 in .secrets - deploy it first.");

const sender = accounts.accounts.find((a) => a.role === "spare");
const owner = accounts.accounts.find((a) => a.role === "payout");
const stranger = accounts.accounts.find((a) => a.role === "deployer");

const strk = (v) => `${(Number(v) / 1e18).toFixed(4)} STRK`;
const felt = (v) => `0x${BigInt(v).toString(16)}`;
const step = (t) => console.log(`\n-- ${t}`);
const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`   ${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

async function view(entrypoint, calldata = []) {
  const result = await reader.callContract({
    contractAddress: ESCROW,
    entrypoint,
    calldata,
  });
  return Array.isArray(result) ? result : (result.result ?? []);
}

async function publicStrk(address) {
  const [lo, hi] = await reader.callContract({
    contractAddress: STRK,
    entrypoint: "balance_of",
    calldata: [address],
  });
  return BigInt(lo) + (BigInt(hi ?? 0) << BigInt(128));
}

function commitmentFor(salt) {
  return num.toHex(
    BigInt(
      hash.computePoseidonHashOnElements([
        shortString.encodeShortString(ESCROW_V2_TAG),
        salt,
      ]),
    ),
  );
}

function randomSalt() {
  return num.toHex(
    BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex")}`),
  );
}

function approvalCall(amount) {
  const value = cairo.uint256(amount);
  return {
    contractAddress: STRK,
    entrypoint: "approve",
    calldata: [network.pool, value.low.toString(), value.high.toString()],
  };
}

function transfersFor(entry, passphrase) {
  return createPrivateTransfers({
    account: {
      address: entry.address,
      signer: new Snip12CallSetSigner({
        accountAddress: entry.address,
        chainId: CHAIN_ID,
        sign: (h) => ec.starkCurve.sign(num.toHex(h), entry.privateKey),
      }),
    },
    viewingKeyProvider: {
      getViewingKey: async () => deriveViewingKey(passphrase, entry.address),
    },
    provingProvider: { url: PROVER_URL, chainId: CHAIN_ID, nodeUrl: PRIVACY_RPC_URL, ohttp: true },
    discoveryProvider: { url: DISCOVERY_URL },
    poolContractAddress: network.pool,
  });
}

async function prove(transfers, builder, block) {
  const invocation = await builder.createProofInvocation({ provingBlockId: block });
  const result = await transfers.executeWithInvocation(invocation, block);
  const { call, proof } = result.callAndProof;
  if (!proof.proofFacts.length || BigInt(proof.proofFacts[0]) !== PROOF1_VERSION) {
    throw new Error("The prover returned unsupported proof facts.");
  }
  return { call, proof: proof.data, proofFacts: proof.proofFacts };
}

async function submitFrom(entry, calls, proofDetails) {
  const account = new Account({ provider, address: entry.address, signer: entry.privateKey });
  const nonce = BigInt(await account.getNonce());
  const options = { nonce, tip: BigInt(0), ...(proofDetails ?? {}) };
  const estimate = await account.estimateInvokeFee(calls, { ...options, skipValidate: true });
  const submission = await account.execute(calls, {
    ...options,
    resourceBounds: estimate.resourceBounds,
  });
  await provider.waitForTransaction(submission.transaction_hash);
  return String(submission.transaction_hash);
}

/** The revert reason, which the RPC buries after a dump of the request. */
function reasonOf(error) {
  const message = String(error?.message ?? error).replace(/\s+/g, " ");
  const named = message.match(/0x[0-9a-f]*\s*\('([A-Z_]+)'\)/);
  return named ? named[1] : message.slice(-160);
}

async function expectRejection(label, expected, run) {
  try {
    await run();
    record(label, false, `it was accepted, and should have failed with ${expected}`);
  } catch (error) {
    const reason = reasonOf(error);
    record(label, reason.includes(expected), reason);
  }
}

/* ------------------------------------------------------------------ */

console.log(`MorokEscrowV2 probe on ${network.name}`);
console.log(`escrow    ${ESCROW}`);
console.log(`sender    spare     ${sender.address}`);
console.log(`owner     payout    ${owner.address}`);
console.log(`stranger  deployer  ${stranger.address}`);

const [poolOfEscrow] = await view("privacy_contract");
const [minStrk] = await view("minimum_amount", [STRK]);
console.log(`\npool      ${poolOfEscrow}`);
console.log(`min STRK  ${strk(BigInt(minStrk))}`);

const transfers = transfersFor(sender, "morok-relay-probe:spare");
const head = await reader.getBlockNumber();
const provingBlock = head - PROVING_BLOCK_DEPTH;
const discovered = await transfers.discoverNotes({
  tokens: [BigInt(STRK)],
  blockIdentifier: provingBlock,
});
const notes = discovered.notes.get(BigInt(STRK)) ?? [];
const shielded = notes.reduce((sum, note) => sum + note.amount, BigInt(0));
console.log(`sender shielded ${strk(shielded)} in ${notes.length} note(s)`);
console.log(`sender public   ${strk(await publicStrk(sender.address))}`);

if (!SUBMIT) {
  console.log(`
Read-only. With --submit this parks ${strk(PARK_AMOUNT)} twice and checks, in order:
  the entry's owner/refund_owner/expiry, the opt-in index, a stranger's claim
  being refused, a refund before expiry being refused, the owner's claim
  landing at a destination of their choosing, and a refund after ${EXPIRY_SECONDS}s.

Each park needs ${strk(PARK_AMOUNT)} shielded plus the ${strk(BigInt(2) * BigInt(10) ** BigInt(18))} pool fee and gas
from the sender's public balance.`);
  process.exit(0);
}

if (shielded < PARK_AMOUNT * BigInt(2)) {
  step(`shielding, because two parks need ${strk(PARK_AMOUNT * BigInt(2))} and there is ${strk(shielded)}`);
  const wanted = PARK_AMOUNT * BigInt(2) + BigInt(10) ** BigInt(18) - shielded;
  const [feeRaw] = await reader.callContract({
    contractAddress: network.pool,
    entrypoint: "get_fee_amount",
    calldata: [],
  });
  const poolFee = BigInt(feeRaw);
  const builder = transfers
    .build({ autoSetup: true })
    .with(STRK, (operations) => {
      operations.deposit({ amount: wanted });
    })
    .surplusTo(sender.address);
  const { call, proof, proofFacts } = await prove(transfers, builder, provingBlock);
  const txHash = await submitFrom(sender, [approvalCall(poolFee + wanted), call], {
    proof,
    proofFacts,
  });
  console.log(`   shielded ${strk(wanted)} - ${txHash}`);
  console.log(`   waiting for the proving block to see the new notes`);
  await new Promise((resolve) => setTimeout(resolve, 90_000));
}

const [feeRaw] = await reader.callContract({
  contractAddress: network.pool,
  entrypoint: "get_fee_amount",
  calldata: [],
});
const poolFee = BigInt(feeRaw);

/** Parks one entry and returns its salt and commitment. */
async function park({ ownerAddress, refundAddress, expiresAt, indexed }) {
  const salt = randomSalt();
  const commitment = commitmentFor(salt);
  const block = (await reader.getBlockNumber()) - PROVING_BLOCK_DEPTH;
  const fresh = await transfers.discoverNotes({
    tokens: [BigInt(STRK)],
    blockIdentifier: block,
  });
  const available = [...(fresh.notes.get(BigInt(STRK)) ?? [])].sort((l, r) =>
    l.amount < r.amount ? -1 : 1,
  );
  const inputs = [];
  let total = BigInt(0);
  for (const note of available) {
    inputs.push(note);
    total += note.amount;
    if (total >= PARK_AMOUNT) break;
  }
  if (total < PARK_AMOUNT) {
    throw new Error(`sender has ${strk(total)} spendable at block ${block}`);
  }

  const builder = transfers
    .build({ autoSetup: true })
    .with(STRK, (operations) => {
      operations.inputs(...inputs);
      operations.withdraw({ recipient: ESCROW, amount: PARK_AMOUNT });
    })
    .invoke(() => ({
      contractAddress: ESCROW,
      calldata: [
        "0x0", // EscrowOperation::Deposit
        commitment,
        STRK,
        felt(PARK_AMOUNT),
        ownerAddress,
        refundAddress,
        felt(expiresAt),
        indexed ? "0x1" : "0x0",
      ],
    }))
    .surplusTo(sender.address);

  const { call, proof, proofFacts } = await prove(transfers, builder, block);
  const txHash = await submitFrom(sender, [approvalCall(poolFee), call], { proof, proofFacts });
  return { salt, commitment, txHash };
}

/* ---------------- 1. deposit records what it was told -------------- */

const now = (await reader.getBlock("latest")).timestamp;
step("1. park an entry owned by payout, refundable by deployer, indexed");
const first = await park({
  ownerAddress: owner.address,
  refundAddress: stranger.address,
  expiresAt: now + 3600,
  indexed: true,
});
console.log(`   tx ${first.txHash}`);
const entry = await view("get_entry", [first.commitment]);
const [token, amount, entryOwner, entryRefund, expiresAt, claimed] = entry;
record(
  "deposit stores owner and refund_owner",
  BigInt(entryOwner) === BigInt(owner.address) &&
    BigInt(entryRefund) === BigInt(stranger.address),
  `owner ${entryOwner}`,
);
record(
  "deposit stores token, amount and expiry",
  BigInt(token) === BigInt(STRK) &&
    BigInt(amount) === PARK_AMOUNT &&
    BigInt(expiresAt) === BigInt(now + 3600) &&
    BigInt(claimed) === BigInt(0),
  `${strk(BigInt(amount))}, expires ${expiresAt}`,
);

/* ---------------- 2. the opt-in index ------------------------------ */

step("2. the index lists it under the owner");
const [count] = await view("entry_count", [owner.address]);
const [listed] = await view("entry_at", [owner.address, felt(BigInt(count) - BigInt(1))]);
record(
  "an indexed entry is discoverable from the owner alone",
  BigInt(listed) === BigInt(first.commitment),
  `entry_count ${BigInt(count)}`,
);

/* ---------------- 3 and 4. the refusals ---------------------------- */

step("3. a stranger cannot claim it");
await expectRejection("claim by a non-owner is refused", "CALLER_NOT_OWNER", () =>
  submitFrom(stranger, [
    {
      contractAddress: ESCROW,
      entrypoint: "claim",
      calldata: [first.commitment, stranger.address],
    },
  ]),
);

step("4. nobody can refund it before it expires");
await expectRejection("refund before expiry is refused", "NOT_EXPIRED", () =>
  submitFrom(stranger, [
    {
      contractAddress: ESCROW,
      entrypoint: "refund",
      calldata: [first.commitment, stranger.address],
    },
  ]),
);

/* ---------------- 5. the owner claims ------------------------------ */

step("5. the owner claims it, to a destination of their choosing");
const destinationBefore = await publicStrk(stranger.address);
const claimTx = await submitFrom(owner, [
  {
    contractAddress: ESCROW,
    entrypoint: "claim",
    calldata: [first.commitment, stranger.address],
  },
]);
console.log(`   tx ${claimTx}`);
const destinationAfter = await publicStrk(stranger.address);
const claimedEntry = await view("get_entry", [first.commitment]);
record(
  "the claim pays the named destination, not the caller",
  destinationAfter - destinationBefore === PARK_AMOUNT,
  strk(destinationAfter - destinationBefore),
);
record("the entry is marked claimed", BigInt(claimedEntry[5]) === BigInt(1));
record(
  "escrowed_total drops back",
  BigInt((await view("escrowed_total", [STRK]))[0]) === BigInt(0),
);
await expectRejection("a second claim is refused", "ALREADY_CLAIMED", () =>
  submitFrom(owner, [
    {
      contractAddress: ESCROW,
      entrypoint: "claim",
      calldata: [first.commitment, owner.address],
    },
  ]),
);

/* ---------------- 6. expiry, then refund --------------------------- */

step(`6. park a second entry expiring in ${EXPIRY_SECONDS}s, then refund it`);
const soon = (await reader.getBlock("latest")).timestamp + EXPIRY_SECONDS;
const second = await park({
  ownerAddress: owner.address,
  refundAddress: stranger.address,
  expiresAt: soon,
  indexed: false,
});
console.log(`   tx ${second.txHash}`);
record(
  "an unindexed entry is not listed",
  BigInt((await view("entry_count", [owner.address]))[0]) === BigInt(count),
  `entry_count still ${BigInt(count)}`,
);

console.log(`   waiting for the expiry to pass`);
for (;;) {
  const current = (await reader.getBlock("latest")).timestamp;
  if (current >= soon) break;
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}

await expectRejection("the owner's claim after expiry is refused", "EXPIRED", () =>
  submitFrom(owner, [
    {
      contractAddress: ESCROW,
      entrypoint: "claim",
      calldata: [second.commitment, owner.address],
    },
  ]),
);

const refundBefore = await publicStrk(stranger.address);
const refundTx = await submitFrom(stranger, [
  {
    contractAddress: ESCROW,
    entrypoint: "refund",
    calldata: [second.commitment, stranger.address],
  },
]);
console.log(`   tx ${refundTx}`);
record(
  "the refund owner gets it back after expiry",
  (await publicStrk(stranger.address)) - refundBefore >= PARK_AMOUNT - BigInt(10) ** BigInt(18),
  strk((await publicStrk(stranger.address)) - refundBefore),
);

step("summary");
const failed = results.filter((item) => !item.passed);
for (const { name, passed } of results) console.log(`   ${passed ? "PASS" : "FAIL"}  ${name}`);
console.log(`\n   ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
