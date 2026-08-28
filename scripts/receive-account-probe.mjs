/**
 * Can a creator's published receive account exist without their main account
 * ever paying for it?
 *
 * That is the whole of requirement 2. `B` is the address on the QR; `A` is the
 * account holding everything else the creator owns. The two stay unlinked only
 * as long as no public transaction pays for one out of the other - and `B`
 * needs two things paid for before it can receive anything: a deployment and a
 * pool registration.
 *
 * So this sends both from MorokPay's relayer and then checks the obvious
 * thing: that `B` holds no public STRK at any point, and that nothing on chain
 * connects it to a main account.
 *
 * The EVM key here stands in for MetaMask. viem's local signer produces the
 * same EIP-712 signature the extension would, and the derivation reads it the
 * same way, so what holds here holds in the browser.
 *
 * Derivation is duplicated from lib/privacy/receive-account.ts - scripts run as
 * plain Node without the app's TypeScript build. The last stage checks the two
 * agree by rederiving the address from the deployed contract's own public key.
 *
 * Usage:
 *   node scripts/receive-account-probe.mjs               # dry run
 *   node scripts/receive-account-probe.mjs --submit
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
import { keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
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
const EVM_CHAIN_ID = 1;
const STATE_FILE = ".secrets/sepolia-receive-account.json";

/* Proof-carrying invokes need 0.10.3; reads go to the steadier endpoint. */
const provider = new RpcProvider({
  nodeUrl: PRIVACY_RPC_URL,
  specVersion: "0.10.3",
});
const reader = new RpcProvider({ nodeUrl: network.rpc });

const store = JSON.parse(readFileSync(network.accountsFile, "utf8"));
const relayer = store.accounts.find((item) => item.role === "deployer");
if (!relayer) throw new Error("No deployer account to stand in for the relayer");

const strk = (value) => `${(Number(value) / 1e18).toFixed(4)} STRK`;
const step = (text) => console.log(`\n-- ${text}`);

/* --- ported from lib/privacy/receive-account.ts --- */

function receiveAccountTypedData(evmAddress) {
  return {
    domain: {
      name: "MorokPay Receive Account",
      version: "1",
      chainId: EVM_CHAIN_ID,
    },
    types: {
      ReceiveAccount: [
        { name: "purpose", type: "string" },
        { name: "evmAccount", type: "address" },
        { name: "starknetChain", type: "string" },
        { name: "privacyPool", type: "uint256" },
      ],
    },
    primaryType: "ReceiveAccount",
    message: {
      purpose: "Derive the MorokPay account your donation QR publishes",
      evmAccount: evmAddress,
      starknetChain: "SN_SEPOLIA",
      privacyPool: BigInt(network.pool),
    },
  };
}

function deriveReceiveAccount(signature) {
  const privateKey = num.toHex(
    BigInt(`0x${ec.starkCurve.grindKey(keccak256(signature))}`),
  );
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  return { privateKey, publicKey, address: receiveAccountAddress(publicKey) };
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

function receiveAccountDeployCall(publicKey) {
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

/* --- chain helpers --- */

async function publicStrk(address) {
  const result = await reader.callContract({
    contractAddress: STRK,
    entrypoint: "balance_of",
    calldata: [address],
  });
  return BigInt(result[0]) + (BigInt(result[1] ?? 0) << BigInt(128));
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

async function submitFromRelayer(calls, proofDetails) {
  const account = new Account({
    provider,
    address: relayer.address,
    signer: relayer.privateKey,
  });
  const nonce = BigInt(await account.getNonce());
  const options = { nonce, tip: BigInt(0), ...(proofDetails ?? {}) };
  const estimate = await account.estimateInvokeFee(calls, {
    ...options,
    skipValidate: true,
  });
  const submission = await account.execute(calls, {
    ...options,
    resourceBounds: estimate.resourceBounds,
  });
  console.log(`   tx ${submission.transaction_hash}`);
  await provider.waitForTransaction(submission.transaction_hash);
  return String(submission.transaction_hash);
}

/* --- the creator's wallet, and the account it derives --- */

let state = null;
if (existsSync(STATE_FILE)) {
  state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
} else if (SUBMIT) {
  mkdirSync(".secrets", { recursive: true });
  state = { evmPrivateKey: generatePrivateKey() };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`Generated a stand-in creator wallet in ${STATE_FILE}`);
}
if (!state) {
  console.log("Dry run needs a wallet; run once with --submit to create one.");
}

const wallet = privateKeyToAccount(
  state?.evmPrivateKey ??
    "0x0000000000000000000000000000000000000000000000000000000000000001",
);
const signature = await wallet.signTypedData(
  receiveAccountTypedData(wallet.address),
);
const receive = deriveReceiveAccount(signature);

console.log(`Receive-account probe on ${network.name}${SUBMIT ? "" : "  (dry run)"}`);
console.log(`creator wallet (stands in for MetaMask) ${wallet.address}`);
console.log(`B  ${receive.address}`);
console.log(`relayer ${relayer.address}`);
console.log(
  `\nB: deployed=${await isDeployed(receive.address)}` +
    ` registered=${await isRegistered(receive.address)}` +
    ` public=${strk(await publicStrk(receive.address))}`,
);

if (!SUBMIT) {
  console.log(`
Dry run. With --submit this would, skipping whatever is already done:
  1. deploy B through the UDC, paid by the relayer, B funded with nothing
  2. register B in the pool through the relayer, which pays the pool fee
  3. check that B never held public STRK and that the deployed contract's own
     public key rederives the same address`);
  process.exit(0);
}

step("1. deploy B, paid by the relayer");
if (await isDeployed(receive.address)) {
  console.log("   already deployed");
} else {
  await submitFromRelayer([receiveAccountDeployCall(receive.publicKey)]);
  console.log(`   deployed at ${receive.address}`);
}

step("2. register B in the pool, paid by the relayer");
if (await isRegistered(receive.address)) {
  console.log("   already registered");
} else {
  const transfers = createPrivateTransfers({
    account: {
      address: receive.address,
      signer: new Snip12CallSetSigner({
        accountAddress: receive.address,
        chainId: CHAIN_ID,
        sign: (messageHash) =>
          ec.starkCurve.sign(num.toHex(messageHash), receive.privateKey),
      }),
    },
    viewingKeyProvider: {
      getViewingKey: async () => deriveViewingKey(signature, receive.address),
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
  const [feeRaw] = await reader.callContract({
    contractAddress: network.pool,
    entrypoint: "get_fee_amount",
    calldata: [],
  });
  const poolFee = BigInt(feeRaw);
  const block = (await reader.getBlockNumber()) - PROVING_BLOCK_DEPTH;
  /* The proof is checked against a block ten deep, and a contract the pool
     cannot see there does not exist as far as the proof is concerned. A
     freshly deployed B therefore cannot register until it has aged - the same
     wait a fresh note needs before it can be spent. */
  if (!(await isDeployed(receive.address, block))) {
    throw new Error(
      `B is deployed, but proving block ${block} cannot see it yet. Wait about ${PROVING_BLOCK_DEPTH} blocks and run again; the deployment is not repeated.`,
    );
  }
  const invocation = await transfers
    .build()
    .register()
    .createProofInvocation({ provingBlockId: block });
  const result = await transfers.executeWithInvocation(invocation, block);
  const { call, proof } = result.callAndProof;
  if (
    !proof.proofFacts.length ||
    BigInt(proof.proofFacts[0]) !== PROOF1_VERSION
  ) {
    throw new Error("The prover returned unsupported proof facts.");
  }
  /* The approval is the relayer's, because collect_fee charges the caller.
     This is exactly why B never needs a STRK top-up from the creator. */
  await submitFromRelayer([approvalCall(poolFee), call], {
    proof: proof.data,
    proofFacts: proof.proofFacts,
  });
  console.log("   registered");
}

step("3. what B cost its owner");
const balance = await publicStrk(receive.address);
const classHash = await reader.getClassHashAt(receive.address);
const [onChainKey] = await reader.callContract({
  contractAddress: receive.address,
  entrypoint: "get_public_key",
  calldata: [],
});
console.log(`   B public STRK          ${strk(balance)}`);
console.log(`   B class hash           ${classHash}`);
console.log(`   B registered in pool   ${await isRegistered(receive.address)}`);
console.log(`   address from chain key ${receiveAccountAddress(num.toHex(BigInt(onChainKey)))}`);
console.log(`   address from signature ${receive.address}`);

if (balance !== BigInt(0)) {
  throw new Error(
    `B holds ${strk(balance)}. Something funded it, and whoever did is now linked to this QR.`,
  );
}
if (
  BigInt(receiveAccountAddress(num.toHex(BigInt(onChainKey)))) !==
  BigInt(receive.address)
) {
  throw new Error("The deployed account does not match the derived address.");
}

console.log(`
Verdict: B is deployed and registered, and has never held a single wei of
public STRK. Nothing paid for it except MorokPay, so no transaction ties it to
the creator's main account. The signature alone rebuilds it: same wallet, same
address, any device.

  ${network.explorer}/contract/${receive.address}`);
