/**
 * Can a stranger with only an EVM key collect private money in one step, on
 * somebody else's gas?
 *
 * docs/evm-escrow-invoices.md argues the public claim should be the default
 * because a private claim drags the whole 6-STRK, viewing-key, buy-STRK-first
 * onboarding in front of money the recipient is trying to collect. That is
 * only true if those steps cannot be hidden. This probe tests whether they
 * can:
 *
 *   1. the relayer deploys the recipient's derived account and sends it NO
 *      STRK - the account must never need any;
 *   2. a registered sender parks funds in MorokEscrow for it;
 *   3. **one** action set, one proof, one transaction, submitted and paid for
 *      by the relayer, does `register` + open note + `privacy_invoke(Claim)`
 *      together.
 *
 * Step 3 is the claim under test. The SDK builder does not forbid it -
 * `register()` only sets `setViewingKey` and the sole restriction is one
 * invoke phase per transaction - and the pool does not authenticate its
 * caller, so a relayer may submit a proven action set for someone else
 * (docs/relayed-submission.md). Neither fact is the same as it working.
 *
 * Timings are printed per step because the product claim is "registration
 * takes 30 seconds", and that number should be measured rather than promised.
 * The proving-block wait is reported separately: a freshly deployed account is
 * invisible to a proof over `latest - 10`, so in production the deploy belongs
 * at invoice-creation time, not at claim time.
 *
 * Usage:
 *   node scripts/sponsored-claim-probe.mjs             # dry run, no spend
 *   node scripts/sponsored-claim-probe.mjs --submit
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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  getAddress,
  padHex,
  parseSignature,
  recoverMessageAddress,
  recoverTypedDataAddress,
  toHex,
} from "viem";
import { Open, createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import { deriveViewingKey } from "@starkware-libs/starknet-privacy-client";
import {
  Eip712TypedDataSigner,
  Snip12CallSetSigner,
} from "@starkware-libs/starknet-privacy-client/signers";

import { resolveNetwork, STRK } from "./lib/networks.mjs";

const SUBMIT = process.argv.includes("--submit");
const network = resolveNetwork("sepolia");

const PROVER_URL = `https://transaction-prover.alpha-${network.name}.sw-dev.io`;
const DISCOVERY_URL = `https://discovery-service.alpha-${network.name}.sw-dev.io`;
const PRIVACY_RPC_URL =
  process.env.STARKNET_PRIVACY_SEPOLIA_RPC_URL ??
  "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";
const CHAIN_ID = constants.StarknetChainId.SN_SEPOLIA;
const SN_CHAIN_NAME = "SN_SEPOLIA";
/* What a MetaMask user connected to Ethereum mainnet actually reports. It is a
   domain-separation value only; nothing consults an external chain. */
const EVM_CHAIN_ID = 1;
const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = BigInt("0x50524f4f4631");
const MASK_128 = (BigInt(1) << BigInt(128)) - BigInt(1);
const ESCROW_TAG = "MOROK_ESCROW:V1";
const PARK_AMOUNT = BigInt(10) ** BigInt(18) / BigInt(20); // 0.05 STRK
const STATE_FILE = ".secrets/sepolia-sponsored-claim-probe.json";
const OWNERSHIP_MESSAGE = "Sign to verify that you own this account.";
/* The Sepolia factory, from lib/starknet/constants.ts - .secrets never
   recorded it, unlike mainnet's. */
const FACTORY = "0x078ce3c3e3080a579d268feae011761b32146efd40f4faa14dc8b9a30b4de35f";
/* From lib/privacy/eth712-account.ts. The Sepolia factory is still configured
   for the legacy class, so a deploy there needs the upgrade below; mainnet's
   factory already points at the compatible one. */
const LEGACY_CLASS = "0x39ffe6e5bffb04de53189d1f4018f113d7ddcbc8ca5874f7a4986b4d1a77f55";
const STRK20_CLASS = "0x697437b25b81bcdd2d1b231d3b8670849fb318555903dbc2fefce2a1a35586e";

const provider = new RpcProvider({ nodeUrl: PRIVACY_RPC_URL, specVersion: "0.10.3" });
const reader = new RpcProvider({ nodeUrl: network.rpc });

const accounts = JSON.parse(readFileSync(network.accountsFile, "utf8"));
const contracts = JSON.parse(readFileSync(network.contractsFile, "utf8"));
const ESCROW = contracts.escrow.address;
/* Two roles kept apart so the cost table can say who paid for what: `spare`
   is the only registered account with a shielded balance, and `payout` stands
   in for MorokPay's relayer. */
const sender = accounts.accounts.find((a) => a.role === "spare");
const relayerEntry = accounts.accounts.find((a) => a.role === "payout");

const strk = (v) => `${(Number(v) / 1e18).toFixed(4)} STRK`;
const felt = (v) => `0x${BigInt(v).toString(16)}`;
const timings = [];
const costs = [];

function step(text) {
  console.log(`\n-- ${text}`);
}

async function timed(label, fn) {
  const started = Date.now();
  const value = await fn();
  const seconds = (Date.now() - started) / 1000;
  timings.push({ label, seconds });
  console.log(`   [${seconds.toFixed(1)}s] ${label}`);
  return value;
}

async function publicStrk(address) {
  const [lo, hi] = await reader.callContract({
    contractAddress: STRK,
    entrypoint: "balance_of",
    calldata: [address],
  });
  return BigInt(lo) + (BigInt(hi ?? 0) << BigInt(128));
}

async function view(contract, entrypoint, calldata = []) {
  try {
    return { ok: await reader.callContract({ contractAddress: contract, entrypoint, calldata }) };
  } catch (error) {
    return { err: String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 160) };
  }
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

function approvalCall(amount) {
  const value = cairo.uint256(amount);
  return {
    contractAddress: STRK,
    entrypoint: "approve",
    calldata: [network.pool, value.low.toString(), value.high.toString()],
  };
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

/* Ported from lib/privacy/evm-strk20-account.ts: the SDK hands over typed data
   whose chainId and verifyingContract need coercing before viem will sign it. */
function normalizedCallSet(typedData) {
  return {
    ...typedData,
    domain: {
      ...typedData.domain,
      chainId: BigInt(typedData.domain.chainId),
      verifyingContract: getAddress(padHex(typedData.domain.verifyingContract, { size: 20 })),
    },
    message: {
      calls: typedData.message.calls.map((call) => ({
        address: BigInt(call.address),
        selector: BigInt(call.selector),
        data: call.data.map(BigInt),
      })),
      additional_data: typedData.message.additional_data.map(BigInt),
    },
  };
}

/* Mirrors lib/privacy/eip712-test.ts with Sepolia's pool and factory. */
function privacyKeyTypedData(evmAddress) {
  return {
    domain: { name: "MorokPay Privacy Access", version: "1", chainId: EVM_CHAIN_ID },
    types: {
      PrivacyAccess: [
        { name: "purpose", type: "string" },
        { name: "evmAccount", type: "address" },
        { name: "starknetChain", type: "string" },
        { name: "privacyPool", type: "uint256" },
        { name: "accountFactory", type: "uint256" },
      ],
    },
    primaryType: "PrivacyAccess",
    message: {
      purpose: "Derive the MorokPay STRK20 viewing key",
      evmAccount: evmAddress,
      starknetChain: SN_CHAIN_NAME,
      privacyPool: BigInt(network.pool),
      accountFactory: BigInt(FACTORY),
    },
  };
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

function loadState() {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
}

function saveState(patch) {
  writeFileSync(STATE_FILE, JSON.stringify({ ...loadState(), ...patch }, null, 2));
}

/* ------------------------------------------------------------------ */

let state = loadState();
if (!state.evmPrivateKey) {
  if (!SUBMIT) {
    console.log("Dry run: would generate a fresh local EVM key and persist it.");
  } else {
    state = { evmPrivateKey: generatePrivateKey() };
    saveState(state);
    console.log(`Generated a fresh local EVM key in ${STATE_FILE}`);
  }
}
const evmAccount = privateKeyToAccount(state.evmPrivateKey ?? generatePrivateKey());
const evmAddress = evmAccount.address;

async function signTypedDataChecked(typedData) {
  const signature = await evmAccount.signTypedData(typedData);
  const recovered = await recoverTypedDataAddress({ ...typedData, signature });
  if (recovered.toLowerCase() !== evmAddress.toLowerCase()) {
    throw new Error(`Local signer produced ${recovered}, expected ${evmAddress}`);
  }
  return signature;
}

const [expected] = await reader.callContract({
  contractAddress: FACTORY,
  entrypoint: "get_expected_account_address",
  calldata: [felt(BigInt(evmAddress))],
});
const recipientAddress = num.toHex(BigInt(expected));

console.log(`Sponsored-claim probe on ${network.name}`);
console.log(`pool       ${network.pool}`);
console.log(`escrow     ${ESCROW}`);
console.log(`factory    ${FACTORY}`);
console.log(`sender     spare   ${sender.address}`);
console.log(`relayer    payout  ${relayerEntry.address}`);
console.log(`recipient  ${evmAddress}`);
console.log(`           -> ${recipientAddress}`);

const relayerBefore = await publicStrk(relayerEntry.address);
const senderBefore = await publicStrk(sender.address);
console.log(`\nrelayer holds ${strk(relayerBefore)}, sender holds ${strk(senderBefore)}`);

if (!SUBMIT) {
  console.log(`
Dry run. With --submit this would, skipping whatever is already done:
  1. relayer deploys ${recipientAddress} through the factory, sending it no STRK
  2. sender parks ${strk(PARK_AMOUNT)} in the escrow behind a fresh secret
  3. wait for the deploy to be visible at the proving block
  4. relayer submits ONE proven action set: register + open note + claim
  5. verify registration, the escrow entry, and the recipient's private balance`);
  process.exit(0);
}

const relayer = new Account({
  provider,
  address: relayerEntry.address,
  signer: relayerEntry.privateKey,
  cairoVersion: "1",
});
const [feeRaw] = await reader.callContract({
  contractAddress: network.pool,
  entrypoint: "get_fee_amount",
  calldata: [],
});
const poolFee = BigInt(feeRaw);

/* ---------------- 1. deploy, on the relayer's gas ------------------ */

step("1. relayer deploys the recipient's account, and sends it nothing");
if (await isDeployed(recipientAddress)) {
  console.log("   already deployed - skipping");
} else {
  const ownershipSignature = await evmAccount.signMessage({ message: OWNERSHIP_MESSAGE });
  const verified = await recoverMessageAddress({
    message: OWNERSHIP_MESSAGE,
    signature: ownershipSignature,
  });
  if (verified.toLowerCase() !== evmAddress.toLowerCase()) {
    throw new Error("Ownership signature did not recover to the EVM address.");
  }
  const { r, s, yParity } = parseSignature(ownershipSignature);
  const deployCall = {
    contractAddress: FACTORY,
    entrypoint: "deploy_account",
    calldata: [
      felt(BigInt(evmAddress)),
      felt(BigInt(r) & MASK_128),
      felt(BigInt(r) >> BigInt(128)),
      felt(BigInt(s) & MASK_128),
      felt(BigInt(s) >> BigInt(128)),
      felt(BigInt(yParity)),
    ],
  };

  const before = await publicStrk(relayerEntry.address);
  const txHash = await timed("deploy submitted and accepted", async () => {
    const estimate = await relayer.estimateInvokeFee([deployCall], {
      skipValidate: true,
      tip: BigInt(0),
    });
    const submission = await relayer.execute([deployCall], {
      resourceBounds: estimate.resourceBounds,
      tip: BigInt(0),
    });
    await provider.waitForTransaction(submission.transaction_hash);
    return String(submission.transaction_hash);
  });
  const spent = before - (await publicStrk(relayerEntry.address));
  costs.push({ who: "relayer", what: "deploy the recipient's account", spent });
  console.log(`   tx ${txHash}  cost ${strk(spent)}`);
  saveState({ recipientAddress, deployTx: txHash });
}
console.log(`   recipient public STRK: ${strk(await publicStrk(recipientAddress))}`);

/* ---------------- 1b. sponsored upgrade to the STRK20 class -------- */

step("1b. relayer pays for the upgrade to the STRK20-compatible class");
const deployedClass = await reader.getClassHashAt(recipientAddress);
if (BigInt(deployedClass) === BigInt(STRK20_CLASS)) {
  console.log("   already on the compatible class - skipping");
} else if (BigInt(deployedClass) !== BigInt(LEGACY_CLASS)) {
  throw new Error(`Unexpected account class ${deployedClass}.`);
} else {
  /* The Sepolia factory still deploys the legacy class, which cannot validate
     the pool's CallSet - the first run of this probe got INVALID_SIGNATURE
     from the pool for exactly that reason. `upgrade` is self-only, and the
     account holds no STRK, but the legacy class does expose
     `execute_from_outside_v2` (checked against its deployed ABI), so the
     recipient signs an intent and the relayer pays. The recipient still
     never needs STRK. */
  console.log(`   on the legacy class ${deployedClass}`);
  const intent = {
    caller: relayerEntry.address,
    nonce: num.toHex(
      BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex")}`),
    ),
    executeAfter: 0,
    executeBefore: Math.floor(Date.now() / 1000) + 3600,
    calls: [
      {
        to: recipientAddress,
        selector: hash.getSelectorFromName("upgrade"),
        // Option::None is variant 1; see lib/privacy/eth712-account.ts.
        calldata: [STRK20_CLASS, "0x1"],
      },
    ],
  };

  const signature = await timed("recipient signs the upgrade intent", async () => {
    const typedData = {
      domain: {
        name: SN_CHAIN_NAME,
        version: "2",
        chainId: BigInt(EVM_CHAIN_ID),
        /* The full Starknet address does not fit an EIP-712
           verifyingContract, so the class uses its low 128 bits. */
        verifyingContract: padHex(toHex(BigInt(recipientAddress) & MASK_128), { size: 20 }),
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Call: [
          { name: "address", type: "uint256" },
          { name: "selector", type: "uint256" },
          { name: "data", type: "uint256[]" },
        ],
        /* Field order is load-bearing: `calls` before `caller`. */
        OutsideExecution: [
          { name: "calls", type: "Call[]" },
          { name: "caller", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "execute_after", type: "uint256" },
          { name: "execute_before", type: "uint256" },
        ],
      },
      primaryType: "OutsideExecution",
      message: {
        calls: intent.calls.map((call) => ({
          address: BigInt(call.to),
          selector: BigInt(call.selector),
          data: call.calldata.map((v) => BigInt(v)),
        })),
        caller: BigInt(intent.caller),
        nonce: BigInt(intent.nonce),
        execute_after: BigInt(intent.executeAfter),
        execute_before: BigInt(intent.executeBefore),
      },
    };
    return signTypedDataChecked(typedData);
  });

  const { r, s, yParity } = parseSignature(signature);
  const signatureFelts = [
    BigInt(r) >> BigInt(128),
    BigInt(r) & MASK_128,
    BigInt(s) >> BigInt(128),
    BigInt(s) & MASK_128,
    BigInt(27 + yParity),
    BigInt(EVM_CHAIN_ID),
  ].map(felt);

  const calldata = [
    felt(intent.caller),
    felt(intent.nonce),
    felt(intent.executeAfter),
    felt(intent.executeBefore),
    felt(intent.calls.length),
    ...intent.calls.flatMap((call) => [
      felt(call.to),
      felt(call.selector),
      felt(call.calldata.length),
      ...call.calldata.map(felt),
    ]),
    felt(signatureFelts.length),
    ...signatureFelts,
  ];

  const before = await publicStrk(relayerEntry.address);
  const txHash = await timed("relayer submits the upgrade", async () => {
    const upgradeCall = {
      contractAddress: recipientAddress,
      entrypoint: "execute_from_outside_v2",
      calldata,
    };
    const estimate = await relayer.estimateInvokeFee([upgradeCall], {
      skipValidate: true,
      tip: BigInt(0),
    });
    const submission = await relayer.execute([upgradeCall], {
      resourceBounds: estimate.resourceBounds,
      tip: BigInt(0),
    });
    await provider.waitForTransaction(submission.transaction_hash);
    return String(submission.transaction_hash);
  });
  const spent = before - (await publicStrk(relayerEntry.address));
  costs.push({ who: "relayer", what: "upgrade the account to the STRK20 class", spent });
  console.log(`   tx ${txHash}  cost ${strk(spent)}`);
  console.log(`   class now ${await reader.getClassHashAt(recipientAddress)}`);
  saveState({ upgradeTx: txHash });
}

/* ---------------- 2. the sender parks the money ------------------- */

step(`2. sender parks ${strk(PARK_AMOUNT)} in the escrow`);
let secret = loadState().secret;
if (loadState().parkTx) {
  console.log("   already parked - skipping");
} else {
  secret = num.toHex(
    BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex")}`),
  );
  const commitment = escrowCommitment(secret);
  saveState({ secret, commitment });

  const senderTransfers = createPrivateTransfers({
    account: {
      address: sender.address,
      signer: new Snip12CallSetSigner({
        accountAddress: sender.address,
        chainId: CHAIN_ID,
        sign: (h) => ec.starkCurve.sign(num.toHex(h), sender.privateKey),
      }),
    },
    viewingKeyProvider: {
      getViewingKey: async () => deriveViewingKey("morok-relay-probe:spare", sender.address),
    },
    provingProvider: { url: PROVER_URL, chainId: CHAIN_ID, nodeUrl: PRIVACY_RPC_URL, ohttp: true },
    discoveryProvider: { url: DISCOVERY_URL },
    poolContractAddress: network.pool,
  });

  const head = await reader.getBlockNumber();
  const block = head - PROVING_BLOCK_DEPTH;
  const discovered = await senderTransfers.discoverNotes({
    tokens: [BigInt(STRK)],
    blockIdentifier: block,
  });
  const notes = discovered.notes.get(BigInt(STRK)) ?? [];
  const inputs = [];
  let total = BigInt(0);
  for (const note of [...notes].sort((l, r) => (l.amount < r.amount ? -1 : 1))) {
    inputs.push(note);
    total += note.amount;
    if (total >= PARK_AMOUNT) break;
  }
  if (total < PARK_AMOUNT) {
    throw new Error(`sender has ${strk(total)} shielded at block ${block}, needs ${strk(PARK_AMOUNT)}.`);
  }

  const before = await publicStrk(sender.address);
  const txHash = await timed("park proven and submitted", async () => {
    const builder = senderTransfers
      .build({ autoSetup: true })
      .with(STRK, (operations) => {
        operations.inputs(...inputs);
        operations.withdraw({ recipient: ESCROW, amount: PARK_AMOUNT });
      })
      .invoke(() => ({
        contractAddress: ESCROW,
        calldata: ["0x0", commitment, STRK, felt(PARK_AMOUNT), "0x0", "0x0"],
      }))
      .surplusTo(sender.address);
    const { call, proof, proofFacts } = await prove(senderTransfers, builder, block);
    const senderAccount = new Account({
      provider,
      address: sender.address,
      signer: sender.privateKey,
    });
    const nonce = BigInt(await senderAccount.getNonce());
    const options = { nonce, tip: BigInt(0), proof, proofFacts };
    const estimate = await senderAccount.estimateInvokeFee([approvalCall(poolFee), call], {
      ...options,
      skipValidate: true,
    });
    const submission = await senderAccount.execute([approvalCall(poolFee), call], {
      ...options,
      resourceBounds: estimate.resourceBounds,
    });
    await provider.waitForTransaction(submission.transaction_hash);
    return String(submission.transaction_hash);
  });
  const spent = before - (await publicStrk(sender.address));
  costs.push({ who: "sender", what: "park the funds (pool fee + gas)", spent });
  console.log(`   tx ${txHash}  cost ${strk(spent)}`);
  saveState({ parkTx: txHash });
}
console.log(`   escrow entry: ${JSON.stringify(await view(ESCROW, "get_entry", [loadState().commitment]))}`);

/* ---------------- 3. wait for the proving block ------------------- */

/* Not just "deployed" - deployed *on the compatible class*. A proof is
   simulated against `latest - 10`, so an account that was still on the legacy
   class at that block is validated by the legacy class, which rejects the
   pool's CallSet: the second run of this probe got INVALID_SIGNATURE from the
   pool for an upgrade that had already landed on chain. The upgrade has to
   age exactly like the deploy. */
step("3. wait until the proving block sees the compatible class");
await timed("proving-block wait", async () => {
  for (;;) {
    const head = await reader.getBlockNumber();
    const block = head - PROVING_BLOCK_DEPTH;
    if (await isDeployed(recipientAddress, block)) {
      const classAtBlock = await reader.getClassHashAt(recipientAddress, block);
      if (BigInt(classAtBlock) === BigInt(STRK20_CLASS)) {
        console.log(`   compatible class visible at block ${block} (head ${head})`);
        return;
      }
      console.log(`   block ${block} still sees ${classAtBlock} - waiting`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
});

/* ---------------- 4. one action set does everything --------------- */

step("4. relayer submits ONE action set: register + open note + claim");

const privacyKeySignature = await timed("recipient signs the viewing-key request", () =>
  signTypedDataChecked(privacyKeyTypedData(evmAddress)),
);
const viewingKey = BigInt(deriveViewingKey(privacyKeySignature, recipientAddress));

const recipientTransfers = createPrivateTransfers({
  account: {
    address: recipientAddress,
    signer: new Eip712TypedDataSigner({
      accountAddress: recipientAddress,
      snChainName: SN_CHAIN_NAME,
      evmChainId: EVM_CHAIN_ID,
      signTypedData: async (typedData) => signTypedDataChecked(normalizedCallSet(typedData)),
    }),
  },
  viewingKeyProvider: { getViewingKey: async () => viewingKey },
  provingProvider: { url: PROVER_URL, chainId: CHAIN_ID, nodeUrl: PRIVACY_RPC_URL, ohttp: true },
  discoveryProvider: { url: DISCOVERY_URL },
  poolContractAddress: network.pool,
});

const head = await reader.getBlockNumber();
const provingBlock = head - PROVING_BLOCK_DEPTH;
const claimSecret = loadState().secret;

const proven = await timed("prover returns one proof for register + note + claim", async () => {
  const builder = recipientTransfers
    .build()
    .register()
    .setup(recipientAddress)
    .with(STRK, (operations) => {
      /* Two setups, not one. The pool wants a channel *and* a per-token
         subchannel, and a fresh account has neither - the first run of this
         probe supplied only the channel and the pool answered
         SUBCHANNEL_NOT_FOUND. `setup` on the parent builder pushes
         openChannels; `setup` here pushes openTokenChannels. */
      operations.setup(recipientAddress);
      operations.transfer({ recipient: recipientAddress, amount: Open });
    })
    .invoke(({ openNotes }) => ({
      contractAddress: ESCROW,
      calldata: ["0x1", "0x0", "0x0", "0x0", claimSecret, felt(openNotes[0].noteId)],
    }));
  return prove(recipientTransfers, builder, provingBlock);
});

const relayerBeforeClaim = await publicStrk(relayerEntry.address);
const claimTx = await timed("relayer submits and the chain accepts", async () => {
  const calls = [approvalCall(poolFee), proven.call];
  const options = {
    nonce: BigInt(await relayer.getNonce()),
    tip: BigInt(0),
    proof: proven.proof,
    proofFacts: proven.proofFacts,
  };
  const estimate = await relayer.estimateInvokeFee(calls, { ...options, skipValidate: true });
  const submission = await relayer.execute(calls, {
    ...options,
    resourceBounds: estimate.resourceBounds,
  });
  await provider.waitForTransaction(submission.transaction_hash);
  return String(submission.transaction_hash);
});
const claimSpent = relayerBeforeClaim - (await publicStrk(relayerEntry.address));
costs.push({ who: "relayer", what: "register + open note + claim, in one tx", spent: claimSpent });
console.log(`   tx ${claimTx}`);
console.log(`   ${network.explorer}/tx/${claimTx}`);
console.log(`   cost ${strk(claimSpent)}`);
saveState({ claimTx });

/* ---------------- 5. what actually happened ----------------------- */

step("5. verify");
const [registeredKey] = await reader.callContract({
  contractAddress: network.pool,
  entrypoint: "get_public_key",
  calldata: [recipientAddress],
});
console.log(`   recipient registered      ${BigInt(registeredKey) !== BigInt(0)}`);
console.log(`   escrow entry              ${JSON.stringify(await view(ESCROW, "get_entry", [loadState().commitment]))}`);
console.log(`   escrowed_total(STRK)      ${JSON.stringify(await view(ESCROW, "escrowed_total", [STRK]))}`);
console.log(`   recipient public STRK     ${strk(await publicStrk(recipientAddress))}`);

const finalNotes = await recipientTransfers.discoverNotes({ tokens: [BigInt(STRK)] });
const held = (finalNotes.notes.get(BigInt(STRK)) ?? []).reduce((sum, n) => sum + n.amount, BigInt(0));
console.log(`   recipient private STRK    ${strk(held)}`);

step("timings");
for (const { label, seconds } of timings) {
  console.log(`   ${seconds.toFixed(1).padStart(7)}s  ${label}`);
}
const userFacing = timings
  .filter((t) => !/proving-block wait|park /.test(t.label))
  .reduce((sum, t) => sum + t.seconds, 0);
console.log(`   ${userFacing.toFixed(1).padStart(7)}s  what the recipient actually waits for`);

step("who paid what");
for (const { who, what, spent } of costs) {
  console.log(`   ${who.padEnd(8)} ${strk(spent).padStart(14)}  ${what}`);
}
console.log(`\n   The recipient's account still holds ${strk(await publicStrk(recipientAddress))} of its own.`);
