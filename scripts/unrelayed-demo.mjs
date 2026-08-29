/**
 * The "before" half of the relay story: what a private transfer looks like
 * when the donor submits it themselves.
 *
 * Every other probe in this repo relays the first transfer on purpose - that
 * is the fix. This one deliberately does NOT relay, so there is a concrete,
 * on-chain example of the problem to point at: the donor's own address in
 * the transaction envelope, the recipient's address in the plaintext
 * calldata, both readable by anyone, in the one transaction that opens a
 * channel to a brand-new recipient.
 *
 * `spare` already holds shielded STRK and is already registered - the only
 * thing this needs to do is deploy and register a throwaway recipient that
 * has never received from anyone, so the channel is provably new.
 *
 * Usage:
 *   node scripts/unrelayed-demo.mjs               # dry run
 *   node scripts/unrelayed-demo.mjs --submit
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  Account,
  CallData,
  RpcProvider,
  cairo,
  constants,
  ec,
  hash,
  num,
} from "starknet";
import { createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import { deriveViewingKey } from "@starkware-libs/starknet-privacy-client";
import { Snip12CallSetSigner } from "@starkware-libs/starknet-privacy-client/signers";

import { resolveNetwork, STRK, OZ_CLASS_HASH } from "./lib/networks.mjs";

const SUBMIT = process.argv.includes("--submit");
const network = resolveNetwork("sepolia");

const UDC = "0x041a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf";
const PROVER_URL = `https://transaction-prover.alpha-${network.name}.sw-dev.io`;
const DISCOVERY_URL = `https://discovery-service.alpha-${network.name}.sw-dev.io`;
const PRIVACY_RPC_URL =
  process.env.STARKNET_PRIVACY_SEPOLIA_RPC_URL ??
  "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";
const CHAIN_ID = constants.StarknetChainId.SN_SEPOLIA;
const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = BigInt("0x50524f4f4631");
const STATE_FILE = ".secrets/sepolia-unrelayed-demo.json";
const TRANSFER_AMOUNT = BigInt(10) ** BigInt(18) / BigInt(10); // 0.1 STRK

const provider = new RpcProvider({
  nodeUrl: PRIVACY_RPC_URL,
  specVersion: "0.10.3",
});
const reader = new RpcProvider({ nodeUrl: network.rpc });
const store = JSON.parse(readFileSync(network.accountsFile, "utf8"));

const spare = store.accounts.find((a) => a.role === "spare");
const deployer = store.accounts.find((a) => a.role === "deployer");

const strk = (v) => `${(Number(v) / 1e18).toFixed(4)} STRK`;
const step = (t) => console.log(`\n-- ${t}`);

/* Deploy/fund calls carry no proof and could use either RPC, but proof-
   carrying submissions need the 0.10.3-pinned one - an unpinned endpoint
   silently drops `proof`/`proof_facts` and the pool answers
   EMPTY_PROOF_FACTS. One account builder for both keeps that from being a
   choice a caller can get wrong. */
function outerAccount(entry) {
  return new Account({ provider, address: entry.address, signer: entry.privateKey });
}

async function publicStrk(address) {
  const [lo, hi] = await reader.callContract({
    contractAddress: STRK,
    entrypoint: "balance_of",
    calldata: [address],
  });
  return BigInt(lo) + (BigInt(hi ?? 0) << BigInt(128));
}

async function isDeployed(address, blockIdentifier) {
  try {
    await reader.getClassHashAt(address, blockIdentifier);
    return true;
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/contract not found|is not deployed|20:/i.test(message)) return false;
    throw error;
  }
}

async function isRegistered(address) {
  const [key = "0x0"] = await reader.callContract({
    contractAddress: network.pool,
    entrypoint: "get_public_key",
    calldata: [address],
  });
  return BigInt(key) !== BigInt(0);
}

function approvalCall(amount) {
  const value = cairo.uint256(amount);
  return {
    contractAddress: STRK,
    entrypoint: "approve",
    calldata: [network.pool, value.low.toString(), value.high.toString()],
  };
}

function deployCall(publicKey) {
  return {
    contractAddress: UDC,
    entrypoint: "deployContract",
    calldata: CallData.compile({
      classHash: OZ_CLASS_HASH,
      salt: publicKey,
      unique: "0",
      calldata: [publicKey],
    }),
  };
}

function receiveAccountAddress(publicKey) {
  return num.toHex(
    BigInt(
      hash.calculateContractAddressFromHash(
        publicKey,
        OZ_CLASS_HASH,
        CallData.compile({ publicKey }),
        0,
      ),
    ),
  );
}

async function submitSelf(entry, calls, proofDetails) {
  const account = outerAccount(entry);
  const nonce = BigInt(await account.getNonce());
  const options = { nonce, tip: BigInt(0), ...(proofDetails ?? {}) };
  const estimate = await account.estimateInvokeFee(calls, { ...options, skipValidate: true });
  const submission = await account.execute(calls, { ...options, resourceBounds: estimate.resourceBounds });
  console.log(`   tx ${submission.transaction_hash}`);
  await provider.waitForTransaction(submission.transaction_hash);
  return String(submission.transaction_hash);
}

/* spare was registered by scripts/relay-probe.mjs under this exact
   passphrase - the on-chain public key is derived from it, so a different
   label here would produce a key that cannot decrypt spare's own notes.
   The throwaway recipient is registered fresh in this script, so its own
   label is free to be anything. */
function viewingPassphrase(entry) {
  return entry.role === "spare"
    ? `morok-relay-probe:spare`
    : `morok-unrelayed-demo:${entry.role}`;
}

function privateTransfersFor(entry) {
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
      getViewingKey: async () => deriveViewingKey(viewingPassphrase(entry), entry.address),
    },
    provingProvider: { url: PROVER_URL, chainId: CHAIN_ID, nodeUrl: PRIVACY_RPC_URL, ohttp: true },
    discoveryProvider: { url: DISCOVERY_URL },
    poolContractAddress: network.pool,
  });
}

async function provingBlock() {
  return (await reader.getBlockNumber()) - PROVING_BLOCK_DEPTH;
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

/* ------------------------------------------------------------------ */

let state = null;
if (existsSync(STATE_FILE)) {
  state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
} else if (SUBMIT) {
  const privateKey = num.toHex(BigInt(ec.starkCurve.utils.randomPrivateKey().reduce((a, b) => a * 256n + BigInt(b), 0n)) % (BigInt(2) ** BigInt(240)));
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  state = { privateKey, publicKey, address: receiveAccountAddress(publicKey) };
  mkdirSync(".secrets", { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`Generated a throwaway recipient in ${STATE_FILE}`);
}

console.log(`Unrelayed-transfer demo on ${network.name}${SUBMIT ? "" : "  (dry run)"}`);
console.log(`sender (submits itself)  spare  ${spare.address}`);
if (state) console.log(`recipient (never paid before)  ${state.address}`);

if (!SUBMIT) {
  console.log(`
Dry run. With --submit this would, skipping whatever is already done:
  1. deploy + fund + register a throwaway recipient that has never received
     anything from anyone
  2. spare submits ONE transfer to it, from spare's OWN account - not relayed
  3. report: spare's address is the transaction's sender; the recipient's
     address is in the calldata, in the clear`);
  process.exit(0);
}

const recipient = { role: "throwaway", address: state.address, privateKey: state.privateKey, publicKey: state.publicKey };

step("1. deploy, fund, register the throwaway recipient");
if (!(await isDeployed(recipient.address))) {
  const account = outerAccount(deployer);
  const { transaction_hash } = await account.execute(deployCall(recipient.publicKey));
  console.log(`   deploy tx ${transaction_hash}`);
  await reader.waitForTransaction(transaction_hash);
} else {
  console.log("   already deployed");
}
if (await publicStrk(recipient.address) < BigInt(15) * BigInt(10) ** BigInt(18)) {
  const account = outerAccount(deployer);
  const amount = BigInt(15) * BigInt(10) ** BigInt(18) - (await publicStrk(recipient.address));
  const value = cairo.uint256(amount);
  const { transaction_hash } = await account.execute({
    contractAddress: STRK,
    entrypoint: "transfer",
    calldata: [recipient.address, value.low.toString(), value.high.toString()],
  });
  console.log(`   funding tx ${transaction_hash}`);
  await reader.waitForTransaction(transaction_hash);
} else {
  console.log("   already funded");
}
if (!(await isRegistered(recipient.address))) {
  const [feeRaw] = await reader.callContract({ contractAddress: network.pool, entrypoint: "get_fee_amount", calldata: [] });
  const poolFee = BigInt(feeRaw);
  const block = await provingBlock();
  if (!(await isDeployed(recipient.address, block))) {
    throw new Error(`Recipient deployed too recently for proving block ${block}. Rerun in a few minutes.`);
  }
  const transfers = privateTransfersFor(recipient);
  const { call, proof, proofFacts } = await prove(transfers, transfers.build().register(), block);
  await submitSelf(recipient, [approvalCall(poolFee), call], { proof, proofFacts });
  console.log("   registered");
} else {
  console.log("   already registered");
}

step("2. spare submits the transfer itself - not relayed");
const spareTransfers = privateTransfersFor(spare);
const block = await provingBlock();
const discovered = await spareTransfers.discoverNotes({ tokens: [BigInt(STRK)], blockIdentifier: block });
const notes = [...(discovered.notes.get(BigInt(STRK)) ?? [])].sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0));
const inputs = [];
let total = BigInt(0);
for (const note of notes) {
  inputs.push(note);
  total += note.amount;
  if (total >= TRANSFER_AMOUNT) break;
}
if (total < TRANSFER_AMOUNT) {
  throw new Error(`spare holds ${strk(total)} spendable at block ${block}, needs ${strk(TRANSFER_AMOUNT)}.`);
}
const [feeRaw] = await reader.callContract({ contractAddress: network.pool, entrypoint: "get_fee_amount", calldata: [] });
const poolFee = BigInt(feeRaw);
const builder = spareTransfers
  .build({ autoSetup: true })
  .with(STRK, (ops) => {
    ops.inputs(...inputs);
    ops.transfer({ recipient: recipient.address, amount: TRANSFER_AMOUNT });
  })
  .surplusTo(spare.address);
const { call, proof, proofFacts } = await prove(spareTransfers, builder, block);
const hashResult = await submitSelf(spare, [approvalCall(poolFee), call], { proof, proofFacts });

step("3. what that transaction shows");
const tx = await reader.getTransactionByHash(hashResult);
const receipt = await reader.getTransactionReceipt(hashResult);
const cd = (tx.calldata ?? []).map(String);
const recipientFelt = BigInt(recipient.address);
const inCalldata = cd.some((f) => {
  try { return BigInt(f) === recipientFelt; } catch { return false; }
});
console.log(`   sender (transaction envelope)  ${tx.sender_address}`);
console.log(`   sender is spare                ${BigInt(tx.sender_address) === BigInt(spare.address)}`);
console.log(`   recipient address in calldata  ${inCalldata}`);
console.log(`   status                         ${receipt.execution_status}`);
console.log(`\n   ${network.explorer}/tx/${hashResult}`);
console.log(`
This is what relaying fixes: submitted this way, the donor IS the
transaction's sender - not hidden in a signature, but the actual on-chain
"who sent this" field every explorer shows - and the recipient sits in
plaintext calldata a few felts over. Anyone reading this one transaction
learns both sides of "donor paid recipient" for the first time, forever.`);
