/**
 * Does the STRK20 pool accept `apply_actions` from an account that is not the
 * payer, and charge the pool fee to that submitter?
 *
 * docs/relayed-submission.md answers "yes" from the Cairo source: there is no
 * `get_caller_address` check on the `apply_actions` path, and `collect_fee`
 * charges `get_caller_address()`. Everything in
 * docs/private-donation-requirements.md rests on that, so it gets one Sepolia
 * transaction before any product code depends on it.
 *
 * Three roles from .secrets/<network>-accounts.json, all plain OpenZeppelin
 * accounts signing the pool's SNIP-12 CallSet with their own key - the same
 * on-chain check the browser's MetaMask account reaches through EIP-712, so
 * what holds here holds there:
 *
 *   donor     (payout)    registers, shields, and *builds* the transfer proof
 *   recipient (spare)     registers, receives - stands in for a creator's B
 *   relayer   (deployer)  submits the donor's proof and pays the pool fee
 *
 * The relayed step is the donor's FIRST transfer to the recipient, which is
 * the one that publishes `Append { recipient_addr }`. That transaction is the
 * whole of requirement 1: if the relayer is its sender, the donor's address
 * never appears next to the recipient's.
 *
 * Every stage checks the chain first and skips itself when already done, so
 * reruns cost only the stages still outstanding. Without --submit the script
 * reads and reports, and sends nothing.
 *
 * One caveat on rerunning: once the channel exists, a rerun relays a *repeat*
 * transfer, which publishes no address at all and so proves less than the
 * first run did. To re-test the channel-opening case, point `recipient` at an
 * address that has never received from this donor.
 *
 * Usage:
 *   node scripts/relay-probe.mjs                     # dry run, reads only
 *   node scripts/relay-probe.mjs --submit            # relayer submits directly
 *   node scripts/relay-probe.mjs --submit --endpoint http://localhost:3000
 *
 * With --endpoint the proof goes to POST /api/privacy/relay instead of being
 * sent from this script's own relayer account, which is how the route itself
 * gets exercised - request shape, rate limit, RPC spec pin and all. That needs
 * MOROKPAY_SEPOLIA_RELAYER_ADDRESS and _PRIVATE_KEY in the server's env.
 */

import { readFileSync } from "node:fs";
import {
  Account,
  RpcProvider,
  cairo,
  constants,
  ec,
  num,
  uint256,
} from "starknet";
import { createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import { deriveViewingKey } from "@starkware-libs/starknet-privacy-client";
import { Snip12CallSetSigner } from "@starkware-libs/starknet-privacy-client/signers";

import { resolveNetwork, STRK } from "./lib/networks.mjs";

const SUBMIT = process.argv.includes("--submit");
const ENDPOINT = (() => {
  const at = process.argv.indexOf("--endpoint");
  if (at < 0) return null;
  const value = process.argv[at + 1];
  if (!value) throw new Error("--endpoint needs a base URL");
  return `${value.replace(/\/$/, "")}/api/privacy/relay`;
})();
const network = resolveNetwork(
  process.argv.find((value) => value === "mainnet") ?? "sepolia",
);

const PROVER_URL = `https://transaction-prover.alpha-${network.name}.sw-dev.io`;
const DISCOVERY_URL = `https://discovery-service.alpha-${network.name}.sw-dev.io`;
/* The SDK proves against an archive-capable node, not the deploy helpers' RPC:
   a proof is checked against a block 10 deep, which pruned endpoints refuse. */
const PRIVACY_RPC_URL =
  process.env.STARKNET_PRIVACY_SEPOLIA_RPC_URL ??
  "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";
const CHAIN_ID =
  network.name === "mainnet"
    ? constants.StarknetChainId.SN_MAIN
    : constants.StarknetChainId.SN_SEPOLIA;

const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = BigInt("0x50524f4f4631");

/* A proof-carrying invoke estimates to roughly 6 STRK of l2 gas bounds on top
   of the 2 STRK pool fee, and the account has to cover the bound, not the
   eventual charge. 15 leaves room for two of them. */
const DONOR_TARGET = BigInt(15) * BigInt(10) ** BigInt(18);
const RECIPIENT_TARGET = BigInt(15) * BigInt(10) ** BigInt(18);
const SHIELD_AMOUNT = BigInt(10) ** BigInt(18);
const TRANSFER_AMOUNT = BigInt(10) ** BigInt(18) / BigInt(2);

/* Two endpoints, on purpose.

   Proof-carrying invokes need an RPC that speaks 0.10.3: `proof` and
   `proof_facts` are transaction fields the older spec drops on the floor, and
   the pool then rejects the call with EMPTY_PROOF_FACTS. That is the same
   node and spec pin the app uses in lib/privacy/evm-strk20-account.ts.

   Reads go elsewhere. The public 0.10.3 endpoint is load-balanced across
   nodes that disagree about recent state, which showed up here as a freshly
   deployed account reading back as undeployed. */
const provider = new RpcProvider({
  nodeUrl: PRIVACY_RPC_URL,
  specVersion: "0.10.3",
});
const reader = new RpcProvider({ nodeUrl: network.rpc });
const store = JSON.parse(readFileSync(network.accountsFile, "utf8"));

function role(name) {
  const entry = store.accounts.find((item) => item.role === name);
  if (!entry) throw new Error(`No account with role "${name}"`);
  return entry;
}

const donor = role("payout");
const recipient = role("spare");
const relayer = role("deployer");

const strk = (value) => `${(Number(value) / 1e18).toFixed(4)} STRK`;

function step(text) {
  console.log(`\n-- ${text}`);
}

async function publicStrk(address) {
  const result = await reader.callContract({
    contractAddress: STRK,
    entrypoint: "balance_of",
    calldata: [address],
  });
  return BigInt(result[0]) + (BigInt(result[1] ?? 0) << BigInt(128));
}

async function poolView(entrypoint, calldata = []) {
  return reader.callContract({
    contractAddress: network.pool,
    entrypoint,
    calldata,
  });
}

/* Only "there is no class at this address" means undeployed. A timeout or a
   rate-limit answered as `false` once sent this script off to redeploy an
   account that was already live. */
async function isDeployed(address) {
  try {
    await reader.getClassHashAt(address);
    return true;
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/contract not found|is not deployed|20:/i.test(message)) return false;
    throw error;
  }
}

async function isRegistered(address) {
  const [key = "0x0"] = await poolView("get_public_key", [address]);
  return BigInt(key) !== BigInt(0);
}

function outerAccount(entry) {
  return new Account({
    provider,
    address: entry.address,
    signer: entry.privateKey,
  });
}

function approvalCall(amount) {
  const value = cairo.uint256(amount);
  return {
    contractAddress: STRK,
    entrypoint: "approve",
    calldata: [network.pool, value.low.toString(), value.high.toString()],
  };
}

/**
 * The pool's OR-fallback accepts `is_valid_signature(compute_call_set_hash(...))`,
 * so a server key can sign the CallSet directly. The browser's EIP-712 path
 * reaches the same on-chain check by a different route.
 */
function privateTransfersFor(entry) {
  const signer = new Snip12CallSetSigner({
    accountAddress: entry.address,
    chainId: CHAIN_ID,
    sign: (messageHash) =>
      ec.starkCurve.sign(num.toHex(messageHash), entry.privateKey),
  });
  return createPrivateTransfers({
    account: { address: entry.address, signer },
    viewingKeyProvider: {
      getViewingKey: async () =>
        deriveViewingKey(`morok-relay-probe:${entry.role}`, entry.address),
    },
    provingProvider: {
      url: PROVER_URL,
      chainId: CHAIN_ID,
      nodeUrl: PRIVACY_RPC_URL,
      ohttp: true,
    },
    discoveryProvider: { url: DISCOVERY_URL },
    poolContractAddress: network.pool,
  });
}

async function provingBlock() {
  const latest = await provider.getBlockNumber();
  return latest - PROVING_BLOCK_DEPTH;
}

/** Proves a built action set and returns the call plus its proof fields. */
async function prove(transfers, builder, block) {
  const invocation = await builder.createProofInvocation({
    provingBlockId: block,
  });
  const result = await transfers.executeWithInvocation(invocation, block);
  const callAndProof = result.callAndProof;
  if (
    !callAndProof.proof.proofFacts.length ||
    BigInt(callAndProof.proof.proofFacts[0]) !== PROOF1_VERSION
  ) {
    throw new Error(
      "The prover returned unsupported proof facts. Nothing submitted.",
    );
  }
  return {
    call: callAndProof.call,
    proof: callAndProof.proof.data,
    proofFacts: callAndProof.proof.proofFacts,
  };
}

/** Submits `calls` from `entry`, carrying the proof on the transaction. */
async function submit(entry, calls, proofDetails) {
  const account = outerAccount(entry);
  const nonce = BigInt(await account.getNonce());
  const estimate = await account.estimateInvokeFee(calls, {
    nonce,
    skipValidate: true,
    tip: BigInt(0),
    ...proofDetails,
  });
  const submission = await account.execute(calls, {
    nonce,
    resourceBounds: estimate.resourceBounds,
    tip: BigInt(0),
    ...proofDetails,
  });
  console.log(`   tx ${submission.transaction_hash}`);
  const receipt = await provider.waitForTransaction(
    submission.transaction_hash,
  );
  return { hash: submission.transaction_hash, receipt };
}

/** Posts the proof to the app's relay route and waits on what it submitted. */
async function submitViaEndpoint(call, proofDetails) {
  console.log(`   POST ${ENDPOINT}`);
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      network: network.name,
      call: {
        contractAddress: call.contractAddress,
        entrypoint: call.entrypoint,
        calldata: (call.calldata ?? []).map((value) => num.toHex(value)),
      },
      proof: proofDetails.proof,
      proofFacts: proofDetails.proofFacts,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.transactionHash) {
    throw new Error(
      `The relay route refused this donation (${response.status}): ${payload?.error ?? "no reason given"}`,
    );
  }
  console.log(`   tx ${payload.transactionHash}  (relayer ${payload.relayerAddress})`);
  const receipt = await provider.waitForTransaction(payload.transactionHash);
  return { hash: payload.transactionHash, receipt };
}

async function fundTo(entry, target) {
  const balance = await publicStrk(entry.address);
  if (balance >= target) {
    console.log(`   ${entry.role} already holds ${strk(balance)}`);
    return;
  }
  const amount = target - balance;
  console.log(`   sending ${strk(amount)} to ${entry.role}`);
  const account = outerAccount(relayer);
  const { transaction_hash } = await account.execute({
    contractAddress: STRK,
    entrypoint: "transfer",
    calldata: [
      entry.address,
      ...Object.values(uint256.bnToUint256(amount)).map(String),
    ],
  });
  console.log(`   tx ${transaction_hash}`);
  await provider.waitForTransaction(transaction_hash);
}

async function ensureDeployed(entry) {
  if (await isDeployed(entry.address)) {
    console.log(`   ${entry.role} already deployed`);
    return;
  }
  const account = outerAccount(entry);
  const { transaction_hash } = await account.deployAccount({
    classHash: store.classHash,
    constructorCalldata: [entry.publicKey],
    addressSalt: entry.publicKey,
  });
  console.log(`   tx ${transaction_hash}`);
  await provider.waitForTransaction(transaction_hash);
}

async function ensureRegistered(entry, poolFee) {
  if (await isRegistered(entry.address)) {
    console.log(`   ${entry.role} already registered`);
    return;
  }
  const transfers = privateTransfersFor(entry);
  const block = await provingBlock();
  const builder = transfers.build().register();
  const { call, ...proofDetails } = await prove(transfers, builder, block);
  await submit(entry, [approvalCall(poolFee), call], proofDetails);
  console.log(`   ${entry.role} registered`);
}

/* ------------------------------------------------------------------ */

console.log(
  `Relayed-submission probe on ${network.name}${SUBMIT ? "" : "  (dry run)"}`,
);
console.log(`pool      ${network.pool}`);
console.log(`donor     ${donor.address}`);
console.log(`recipient ${recipient.address}`);
console.log(`relayer   ${relayer.address}`);

const [feeRaw] = await poolView("get_fee_amount");
const poolFee = BigInt(feeRaw);
console.log(`\npool fee  ${strk(poolFee)}`);

for (const entry of [donor, recipient, relayer]) {
  console.log(
    `${entry.role.padEnd(9)} ${strk(await publicStrk(entry.address)).padStart(14)}` +
      `  deployed=${await isDeployed(entry.address)}` +
      `  registered=${await isRegistered(entry.address)}`,
  );
}
const [channelsBefore] = await poolView("get_num_of_channels", [
  recipient.address,
]);
console.log(`recipient channels: ${BigInt(channelsBefore)}`);

if (!SUBMIT) {
  console.log(`
Dry run. With --submit this would, skipping whatever is already done:
  1. deploy the recipient and top both it and the donor up
  2. register donor and recipient in the pool (each pays its own ${strk(poolFee)})
  3. donor shields ${strk(SHIELD_AMOUNT)}
  4. donor proves a ${strk(TRANSFER_AMOUNT)} transfer to the recipient - the
     first one, so it carries the channel-opening Append - and the RELAYER
     submits that proof
  5. report who paid: the relayer down ${strk(poolFee)} plus gas, the donor's
     public balance untouched`);
  process.exit(0);
}

step("1. fund and deploy");
await fundTo(recipient, RECIPIENT_TARGET);
await ensureDeployed(recipient);
await fundTo(donor, DONOR_TARGET);

step("2. register both sides in the pool");
await ensureRegistered(donor, poolFee);
await ensureRegistered(recipient, poolFee);

step("3. donor shields");
const donorTransfers = privateTransfersFor(donor);
const shieldBlock = await provingBlock();
const held = await donorTransfers.discoverNotes({
  tokens: [BigInt(STRK)],
  blockIdentifier: shieldBlock,
});
const heldNotes = held.notes.get(BigInt(STRK)) ?? [];
const heldTotal = heldNotes.reduce((sum, note) => sum + note.amount, BigInt(0));
console.log(`   donor holds ${strk(heldTotal)} shielded in ${heldNotes.length} note(s)`);
if (heldTotal < TRANSFER_AMOUNT) {
  const builder = donorTransfers
    .build({ autoSetup: true })
    .with(STRK, (operations) => operations.deposit({ amount: SHIELD_AMOUNT }));
  const { call, ...proofDetails } = await prove(
    donorTransfers,
    builder,
    shieldBlock,
  );
  /* One approval covers both: the deposit moves STRK and the fee is STRK. */
  await submit(donor, [approvalCall(SHIELD_AMOUNT + poolFee), call], proofDetails);
  console.log(`   shielded ${strk(SHIELD_AMOUNT)}`);
} else {
  console.log("   enough already shielded, skipping the deposit");
}

step("4. donor proves the first transfer, relayer submits it");
const transferBlock = await provingBlock();
const discovered = await donorTransfers.discoverNotes({
  tokens: [BigInt(STRK)],
  blockIdentifier: transferBlock,
});
const notes = [...(discovered.notes.get(BigInt(STRK)) ?? [])].sort((left, right) =>
  left.amount < right.amount ? -1 : left.amount > right.amount ? 1 : 0,
);
const inputs = [];
let total = BigInt(0);
for (const note of notes) {
  inputs.push(note);
  total += note.amount;
  if (total >= TRANSFER_AMOUNT) break;
}
if (total < TRANSFER_AMOUNT) {
  throw new Error(
    `Proving block ${transferBlock} sees only ${strk(total)} of the ${strk(TRANSFER_AMOUNT)} needed. ` +
      `A fresh deposit needs ${PROVING_BLOCK_DEPTH} blocks before it is spendable - rerun shortly.`,
  );
}
console.log(`   spending ${inputs.length} note(s), ${strk(total)}`);

const transferBuilder = donorTransfers
  .build({ autoSetup: true })
  .with(STRK, (operations) => {
    operations.inputs(...inputs);
    operations.transfer({ recipient: recipient.address, amount: TRANSFER_AMOUNT });
  })
  .surplusTo(donor.address);
const { call: transferCall, ...transferProof } = await prove(
  donorTransfers,
  transferBuilder,
  transferBlock,
);

const donorBefore = await publicStrk(donor.address);
const relayerBefore = await publicStrk(relayer.address);
console.log(`   donor public   ${strk(donorBefore)}`);
console.log(`   relayer public ${strk(relayerBefore)}`);
console.log(
  ENDPOINT
    ? "   handing the donor's proof to the relay route"
    : "   submitting the donor's proof from the RELAYER account",
);

/* The fee is charged to get_caller_address(), so the approval has to come
   from the relayer - the account that will be the caller - not the donor.
   Through the endpoint that approval is the route's job, and the request
   carries only the call and its proof: no address, no signature. */
const relayed = ENDPOINT
  ? await submitViaEndpoint(transferCall, transferProof)
  : await submit(relayer, [approvalCall(poolFee), transferCall], transferProof);

step("5. who paid");
const donorAfter = await publicStrk(donor.address);
const relayerAfter = await publicStrk(relayer.address);
const [channelsAfter] = await poolView("get_num_of_channels", [
  recipient.address,
]);
console.log(`   execution status  ${relayed.receipt.execution_status ?? relayed.receipt.statusReceipt ?? "see receipt"}`);
console.log(`   donor public      ${strk(donorBefore)} -> ${strk(donorAfter)}  (delta ${strk(donorAfter - donorBefore)})`);
console.log(`   relayer public    ${strk(relayerBefore)} -> ${strk(relayerAfter)}  (delta ${strk(relayerAfter - relayerBefore)})`);
console.log(`   recipient channels ${BigInt(channelsBefore)} -> ${BigInt(channelsAfter)}`);
console.log(`\n   ${network.explorer}/tx/${relayed.hash}`);

const recipientTransfers = privateTransfersFor(recipient);
const received = await recipientTransfers.discoverNotes({ tokens: [BigInt(STRK)] });
const receivedTotal = (received.notes.get(BigInt(STRK)) ?? []).reduce(
  (sum, note) => sum + note.amount,
  BigInt(0),
);
console.log(`   recipient shielded balance ${strk(receivedTotal)}`);

step("6. is the donor anywhere in that transaction");
/* The point of the whole exercise, so it is read back off the chain rather
   than asserted. Every felt of the calldata and of every event, against all
   three addresses. */
const sent = await reader.getTransactionByHash(relayed.hash);
const receipt = await reader.getTransactionReceipt(relayed.hash);
const eventFelts = (receipt.events ?? []).flatMap((event) => [
  ...(event.keys ?? []),
  ...(event.data ?? []),
]);
function appears(address, felts) {
  return felts.some((felt) => {
    try {
      return BigInt(felt) === BigInt(address);
    } catch {
      return false;
    }
  });
}
const calldata = (sent.calldata ?? []).map(String);
for (const [name, entry] of [
  ["donor", donor],
  ["recipient", recipient],
  ["relayer", relayer],
]) {
  console.log(
    `   ${name.padEnd(9)} in calldata=${appears(entry.address, calldata)}` +
      `  in events=${appears(entry.address, eventFelts.map(String))}`,
  );
}
console.log(`   outer sender      ${sent.sender_address}`);
console.log(`   gas charged       ${strk(BigInt(receipt.actual_fee.amount))}`);
console.log(`   relayer total     ${strk(poolFee + BigInt(receipt.actual_fee.amount))} (pool fee + gas)`);

const donorTraced =
  appears(donor.address, calldata) || appears(donor.address, eventFelts.map(String));
if (donorTraced || BigInt(sent.sender_address) !== BigInt(relayer.address)) {
  throw new Error(
    "The donor is still traceable in this transaction. Relaying does NOT satisfy requirement 1 as built.",
  );
}
const openedChannel = appears(recipient.address, calldata);
console.log(`
Verdict: the pool accepted a proof built by the donor and submitted by the
relayer, and charged the fee to the relayer. The donor's address is in neither
the calldata nor any event, and their public balance did not move.
${
  openedChannel
    ? "This transfer opened the channel, so the recipient's address is in the calldata - and it is the only address the chain learns."
    : "The channel already existed, so this transfer named nobody at all. It does not re-test the channel-opening case; see the note at the top."
}`);
