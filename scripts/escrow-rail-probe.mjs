/**
 * Is the escrow rail actually open, and which half of it is closed?
 *
 * docs/evm-escrow-invoices.md rests on one unverified claim: that parking
 * money in `MorokEscrow` still works, while *claiming into a private note*
 * does not. The reasoning is that the pool's screening policy is read in
 * `_apply_invoke_and_deposits` and makes the helper's own address the subject
 * of an **open-note deposit** - so a deposit leg that creates no open note
 * should pass, and a claim leg that creates one should be refused.
 *
 * Reasoning is not evidence, and the whole design depends on which way this
 * goes. So this probe submits both legs on Sepolia and reports what the chain
 * says:
 *
 *   deposit  withdraw STRK to the escrow + `privacy_invoke(Deposit)`
 *            -> no open note.
 *   claim    open note to self + `privacy_invoke(Claim)`
 *            -> one open note, depositor = the escrow. This is the leg the
 *               screening policy was expected to refuse.
 *
 * **Both legs succeeded on Sepolia, 2026-09-03.** Deposit
 * `0x3c12c536e2a6…1617` (4.67 STRK), claim `0x7954b7dafc00…7b87` (4.64 STRK),
 * entry claimed and `escrowed_total` back to zero. So the open-note screening
 * risk in docs/relayed-submission.md is not enforced as that document read it:
 * `get_open_note_screening_policy` answers `0` for the escrow, for the
 * invoices helper, and for an address that is not a contract, which makes `0`
 * the unset default rather than an enforced `Required`.
 *
 * Keep running it anyway. The policy map is real and its values belong to the
 * pool's app governor, so this is a measurement of today, not a guarantee.
 *
 * Read-only by default. `spare` is the sender because it is already registered
 * and already holds shielded STRK (see scripts/relay-probe.mjs, which
 * registered it under the passphrase reused below).
 *
 * Usage:
 *   node scripts/escrow-rail-probe.mjs             # read-only, no spend
 *   node scripts/escrow-rail-probe.mjs --deposit   # leg 1, submits
 *   node scripts/escrow-rail-probe.mjs --claim     # leg 2, submits
 *   node scripts/escrow-rail-probe.mjs --shield-and-park
 *
 * The shield-and-park leg answers a separate question - whether one pool fee
 * can do the work of two for a sender arriving with public funds. It can
 * (`0x2f209f1ebb...a504`, 4.77 STRK against ~10 for two transactions), but
 * only for a sender who already holds a note: a set that deposits and
 * withdraws while spending nothing nullifies nothing and is refused with
 * NO_REPLAY_PROTECTION.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
import { Open, createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import { deriveViewingKey } from "@starkware-libs/starknet-privacy-client";
import { Snip12CallSetSigner } from "@starkware-libs/starknet-privacy-client/signers";

import { resolveNetwork, STRK } from "./lib/networks.mjs";

const DEPOSIT = process.argv.includes("--deposit");
const CLAIM = process.argv.includes("--claim");
const SHIELD_PARK = process.argv.includes("--shield-and-park");
const network = resolveNetwork("sepolia");

const PROVER_URL = `https://transaction-prover.alpha-${network.name}.sw-dev.io`;
const DISCOVERY_URL = `https://discovery-service.alpha-${network.name}.sw-dev.io`;
const PRIVACY_RPC_URL =
  process.env.STARKNET_PRIVACY_SEPOLIA_RPC_URL ??
  "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";
const CHAIN_ID = constants.StarknetChainId.SN_SEPOLIA;
const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = BigInt("0x50524f4f4631");
const STATE_FILE = ".secrets/sepolia-escrow-rail-probe.json";
const ESCROW_TAG = "MOROK_ESCROW:V1";
/* Small enough that a failed leg costs almost nothing, large enough that the
   escrow's balance-versus-totals assert has something real to check. */
const PARK_AMOUNT = BigInt(10) ** BigInt(18) / BigInt(20); // 0.05 STRK

/* Proof-carrying submissions need the 0.10.3-pinned endpoint - an unpinned one
   silently drops `proof`/`proof_facts` and the pool answers EMPTY_PROOF_FACTS. */
const provider = new RpcProvider({ nodeUrl: PRIVACY_RPC_URL, specVersion: "0.10.3" });
const reader = new RpcProvider({ nodeUrl: network.rpc });

const accounts = JSON.parse(readFileSync(network.accountsFile, "utf8"));
const contracts = JSON.parse(readFileSync(network.contractsFile, "utf8"));
const spare = accounts.accounts.find((a) => a.role === "spare");
const ESCROW = contracts.escrow.address;

const strk = (v) => `${(Number(v) / 1e18).toFixed(4)} STRK`;
const step = (t) => console.log(`\n-- ${t}`);

async function view(contract, entrypoint, calldata = []) {
  try {
    return { ok: await reader.callContract({ contractAddress: contract, entrypoint, calldata }) };
  } catch (error) {
    return { err: String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 200) };
  }
}

async function publicStrk(address) {
  const [lo, hi] = await reader.callContract({
    contractAddress: STRK,
    entrypoint: "balance_of",
    calldata: [address],
  });
  return BigInt(lo) + (BigInt(hi ?? 0) << BigInt(128));
}

function escrowCommitment(secret) {
  return num.toHex(
    BigInt(
      hash.computePoseidonHashOnElements([
        shortString.encodeShortString(ESCROW_TAG),
        secret,
      ]),
    ),
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

/* spare was registered by scripts/relay-probe.mjs under this exact passphrase;
   the on-chain public key is derived from it, so anything else here produces a
   key that cannot decrypt spare's own notes. */
function privateTransfers() {
  return createPrivateTransfers({
    account: {
      address: spare.address,
      signer: new Snip12CallSetSigner({
        accountAddress: spare.address,
        chainId: CHAIN_ID,
        sign: (h) => ec.starkCurve.sign(num.toHex(h), spare.privateKey),
      }),
    },
    viewingKeyProvider: {
      getViewingKey: async () => deriveViewingKey("morok-relay-probe:spare", spare.address),
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

async function submit(calls, proofDetails) {
  const account = new Account({ provider, address: spare.address, signer: spare.privateKey });
  const before = await publicStrk(spare.address);
  const nonce = BigInt(await account.getNonce());
  const options = { nonce, tip: BigInt(0), ...proofDetails };
  const estimate = await account.estimateInvokeFee(calls, { ...options, skipValidate: true });
  const submission = await account.execute(calls, {
    ...options,
    resourceBounds: estimate.resourceBounds,
  });
  console.log(`   tx ${submission.transaction_hash}`);
  console.log(`   ${network.explorer}/tx/${submission.transaction_hash}`);
  const receipt = await provider.waitForTransaction(submission.transaction_hash);
  const after = await publicStrk(spare.address);
  console.log(`   spent ${strk(before - after)} (pool fee + gas)`);
  return { hash: String(submission.transaction_hash), receipt };
}

function loadState() {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : null;
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ------------------------------------------------------------------ */

console.log(`Escrow rail probe on ${network.name}`);
console.log(`pool     ${network.pool}`);
console.log(`escrow   ${ESCROW}`);
console.log(`sender   spare  ${spare.address}`);

step("state, read-only");

const policyEscrow = await view(network.pool, "get_open_note_screening_policy", [ESCROW]);
const policyPool = await view(network.pool, "get_open_note_screening_policy", [network.pool]);
const [feeRaw] = await reader.callContract({
  contractAddress: network.pool,
  entrypoint: "get_fee_amount",
  calldata: [],
});
const poolFee = BigInt(feeRaw);
const escrowPool = await view(ESCROW, "privacy_contract");
const escrowTotal = await view(ESCROW, "escrowed_total", [STRK]);
const [publicKey = "0x0"] = await reader.callContract({
  contractAddress: network.pool,
  entrypoint: "get_public_key",
  calldata: [spare.address],
});
const spareStrk = await publicStrk(spare.address);

console.log(`   pool fee                      ${strk(poolFee)}`);
console.log(`   open-note policy(escrow)      ${JSON.stringify(policyEscrow)}`);
console.log(`   open-note policy(pool)        ${JSON.stringify(policyPool)}`);
console.log(`   escrow.privacy_contract       ${JSON.stringify(escrowPool)}`);
console.log(`   escrow.escrowed_total(STRK)   ${JSON.stringify(escrowTotal)}`);
console.log(`   spare registered              ${BigInt(publicKey) !== BigInt(0)}`);
console.log(`   spare public STRK             ${strk(spareStrk)}`);

const latestBlock = await reader.getBlockNumber();
const provingBlock = latestBlock - PROVING_BLOCK_DEPTH;
const transfers = privateTransfers();
const discovered = await transfers.discoverNotes({
  tokens: [BigInt(STRK)],
  blockIdentifier: provingBlock,
});
const notes = discovered.notes.get(BigInt(STRK)) ?? [];
const shielded = notes.reduce((sum, note) => sum + note.amount, BigInt(0));
console.log(`   spare shielded STRK           ${strk(shielded)} in ${notes.length} note(s)`);
console.log(`   proving block                 ${provingBlock} (latest ${latestBlock})`);

if (!DEPOSIT && !CLAIM && !SHIELD_PARK) {
  console.log(`
Read-only. Nothing was submitted.

  --deposit   park ${strk(PARK_AMOUNT)} in the escrow behind a fresh secret
              (withdraw + privacy_invoke(Deposit), no open note)
  --claim     claim it back into an open note
              (transfer OPEN to self + privacy_invoke(Claim))

Each leg costs the ${strk(poolFee)} pool fee plus gas, paid from spare's public
STRK balance above.`);
  process.exit(0);
}

if (SHIELD_PARK) {
  /* Does one action set do what two do today?
   *
   * A sender arriving with USDC pays the 6-STRK pool fee twice on mainnet -
   * once to shield, once to park in the escrow - and that is a fifth of their
   * bill (docs/evm-escrow-invoices.md, "What this costs on mainnet"). The pool
   * takes its fee per `apply_actions`, not per action, so if a deposit and a
   * withdraw can share one set the second fee simply disappears.
   *
   * What is untested is whether the pool will let a withdrawal consume a note
   * the same set has just deposited, with no prior input notes at all. */
  step(`shield + park ${strk(PARK_AMOUNT)} in one action set`);
  const publicBefore = await publicStrk(spare.address);
  if (publicBefore < PARK_AMOUNT + poolFee) {
    throw new Error(`spare holds ${strk(publicBefore)}, needs the fee plus the parked amount.`);
  }

  const existing = loadState() ?? {};
  const secret = num.toHex(
    BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex")}`),
  );
  const commitment = escrowCommitment(secret);
  saveState({ ...existing, shieldParkSecret: secret, shieldParkCommitment: commitment });
  console.log(`   commitment ${commitment}`);

  /* A deposit-plus-withdraw with no input notes spends nothing, so it
     nullifies nothing, and the pool refuses it outright: NO_REPLAY_PROTECTION.
     An action set needs at least one spent note to be unrepeatable. Spending
     one existing note supplies that nullifier, and `surplusTo` hands its value
     straight back as a fresh note, so the sender's private balance is
     unchanged and only the freshly deposited amount leaves for the escrow.

     Which bounds the saving: it is available only to a sender who already
     holds a note. A first-time sender has nothing to nullify and must shield
     in its own transaction no matter what. */
  const nullifier = [...notes].sort((l, r) => (l.amount < r.amount ? -1 : 1))[0];
  if (!nullifier) {
    throw new Error("spare holds no note to nullify; shield once before running this leg.");
  }
  console.log(`   spending one ${strk(nullifier.amount)} note for replay protection`);

  const builder = transfers
    .build({ autoSetup: true })
    .with(STRK, (operations) => {
      operations.deposit({ amount: PARK_AMOUNT });
      operations.inputs(nullifier);
      operations.withdraw({ recipient: ESCROW, amount: PARK_AMOUNT });
    })
    .invoke(() => ({
      contractAddress: ESCROW,
      calldata: ["0x0", commitment, STRK, num.toHex(PARK_AMOUNT), "0x0", "0x0"],
    }))
    .surplusTo(spare.address);

  try {
    const { call, proof, proofFacts } = await prove(transfers, builder, provingBlock);
    /* The approval has to cover the deposit as well as the fee - the pool
       pulls both from this account in the same transaction. */
    const { hash: txHash } = await submit([approvalCall(poolFee + PARK_AMOUNT), call], {
      proof,
      proofFacts,
    });
    saveState({ ...loadState(), shieldParkTx: txHash });
    console.log(`   escrow.get_entry              ${JSON.stringify(await view(ESCROW, "get_entry", [commitment]))}`);
    console.log(`
   SHIELD-AND-PARK SUCCEEDED in one action set, so one pool fee`);
    console.log(`   does the work of two - worth ${strk(poolFee)} here and 6 STRK on mainnet.`);
  } catch (error) {
    const message = String(error?.message ?? error).replace(/\s+/g, " ");
    console.log(`
   SHIELD-AND-PARK FAILED. The sender keeps paying two pool fees.`);
    /* The reason is at the END of these messages - the RPC dumps the request
       first, so slicing from the front prints parameters, not the failure. */
    console.log(`   reason: ${message.slice(-700)}`);
  }
}

if (DEPOSIT) {
  step(`leg 1: park ${strk(PARK_AMOUNT)} in the escrow`);
  if (shielded < PARK_AMOUNT) {
    throw new Error(
      `spare has ${strk(shielded)} shielded at block ${provingBlock}, needs ${strk(PARK_AMOUNT)}.`,
    );
  }

  const existing = loadState();
  const secret = existing?.secret ?? num.toHex(BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex")}`));
  const commitment = escrowCommitment(secret);
  saveState({ ...(existing ?? {}), secret, commitment, amount: PARK_AMOUNT.toString() });
  console.log(`   commitment ${commitment}`);

  const inputs = [];
  let total = BigInt(0);
  for (const note of [...notes].sort((l, r) => (l.amount < r.amount ? -1 : 1))) {
    inputs.push(note);
    total += note.amount;
    if (total >= PARK_AMOUNT) break;
  }

  const builder = transfers
    .build({ autoSetup: true })
    .with(STRK, (operations) => {
      operations.inputs(...inputs);
      operations.withdraw({ recipient: ESCROW, amount: PARK_AMOUNT });
    })
    .invoke(() => ({
      contractAddress: ESCROW,
      /* IMorokEscrow::privacy_invoke(operation, commitment, token, amount,
         secret, note_id). Deposit is variant 0; secret and note_id ignored. */
      calldata: ["0x0", commitment, STRK, num.toHex(PARK_AMOUNT), "0x0", "0x0"],
    }))
    .surplusTo(spare.address);

  const { call, proof, proofFacts } = await prove(transfers, builder, provingBlock);
  const { hash: txHash } = await submit([approvalCall(poolFee), call], { proof, proofFacts });
  saveState({ ...loadState(), depositTx: txHash });

  const entry = await view(ESCROW, "get_entry", [commitment]);
  console.log(`   escrow.get_entry              ${JSON.stringify(entry)}`);
  console.log(`   escrow.escrowed_total(STRK)   ${JSON.stringify(await view(ESCROW, "escrowed_total", [STRK]))}`);
  console.log(`\n   DEPOSIT LEG SUCCEEDED - the escrow rail is open for parking funds.`);
}

if (CLAIM) {
  step("leg 2: claim it back into an open note");
  const state = loadState();
  if (!state?.secret) throw new Error(`No parked secret in ${STATE_FILE}. Run --deposit first.`);
  const entry = await view(ESCROW, "get_entry", [state.commitment]);
  console.log(`   entry before ${JSON.stringify(entry)}`);

  const builder = transfers
    .build({ autoSetup: true })
    .with(STRK, (operations) => {
      operations.transfer({ recipient: spare.address, amount: Open });
    })
    .invoke(({ openNotes }) => ({
      contractAddress: ESCROW,
      /* Claim is variant 1; commitment, token and amount are ignored, and the
         note the escrow deposits into is the open note created above. */
      calldata: [
        "0x1",
        "0x0",
        "0x0",
        "0x0",
        state.secret,
        num.toHex(openNotes[0].noteId),
      ],
    }));

  try {
    const { call, proof, proofFacts } = await prove(transfers, builder, provingBlock);
    const { hash: txHash } = await submit([approvalCall(poolFee), call], { proof, proofFacts });
    saveState({ ...loadState(), claimTx: txHash });
    console.log(`   entry after  ${JSON.stringify(await view(ESCROW, "get_entry", [state.commitment]))}`);
    console.log(`\n   CLAIM LEG SUCCEEDED - better than expected. Re-run before relying on it:`);
    console.log(`   Sepolia's open-note policy for the escrow can change without notice.`);
  } catch (error) {
    /* Do not report every failure as the screening gate - the first run of
       this probe did exactly that and was wrong. Only the pool refusing the
       open-note deposit says anything about screening; running out of test
       STRK says something about the faucet, and the two look nothing alike. */
    const message = String(error?.message ?? error);
    const reason = String(
      error?.baseError?.data?.execution_error ??
        error?.baseError?.message ??
        message,
    );
    const flat = `${message} ${reason}`;
    const verdict = /exceed balance|insufficient.*(balance|fee)|max_fee/i.test(flat)
      ? "funds"
      : /screen/i.test(flat)
        ? "screening"
        : "unknown";

    if (verdict === "funds") {
      console.log(`\n   CLAIM LEG NOT ANSWERED - spare ran out of test STRK before the pool
   could accept or refuse it. Nothing was submitted and nothing was spent;
   the entry is still parked. Top spare up and re-run.`);
    } else if (verdict === "screening") {
      console.log(`\n   CLAIM LEG REFUSED BY SCREENING, which is risk 4 in
   docs/evm-escrow-invoices.md. The funds stay parked.`);
    } else {
      console.log(`\n   CLAIM LEG FAILED for a reason this probe does not recognise. Read it
   before concluding anything about screening.`);
    }
    console.log(`   reason: ${reason.replace(/\s+/g, " ").slice(0, 700)}`);
  }
}
