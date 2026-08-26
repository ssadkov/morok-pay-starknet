/**
 * Stage B - a MetaMask-derived Starknet account, registered in the mainnet
 * STRK20 pool, with no Ready involved.
 *
 * scripts/deploy-eth712-factory.mjs put the account class and AccountFactory
 * on mainnet. This script uses them: generates a local EVM key that stands in
 * for MetaMask, signs the exact typed data MetaMask would be asked to sign,
 * deploys the deterministic Starknet account through the factory, and
 * registers it in the live mainnet pool.
 *
 * The EVM signing happens with viem's local account signer, not the browser
 * extension. Cryptographically these are identical - viem's local signer and
 * MetaMask both implement eth_signTypedData_v4 / personal_sign the same way,
 * and the account's on-chain validator has no way to tell them apart. This
 * script proves the mainnet contract path end to end; it does not exercise
 * the browser UI or the extension prompt.
 *
 * Two on-chain steps, both idempotent:
 *   1. deploy   - the `deployer` account funds the target address and calls
 *                 the factory's deploy_account in one transaction (mirrors
 *                 app/api/privacy-sdk/deploy/route.ts's sponsored pattern).
 *   2. register - the deployed account signs and submits its own InvokeV3
 *                 (Eth712TransactionSigner) carrying a pool CallSet authorized
 *                 by a second EIP-712 signature (Eip712TypedDataSigner),
 *                 exactly as components/privacy-sdk/strk20-registration-lab.tsx
 *                 does in the browser.
 *
 * Usage:
 *   MOROK_VIEWING_PASSPHRASE=... node scripts/mainnet-eth712-probe.mjs
 *   MOROK_VIEWING_PASSPHRASE=... node scripts/mainnet-eth712-probe.mjs --submit
 *
 * The EVM key is generated once and persisted to
 * .secrets/mainnet-eth712-account.json (gitignored) so reruns are idempotent
 * instead of minting a new account every time.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  cairo,
  Account,
  CallData,
  RpcProvider,
  SignerInterface,
  constants,
  hash,
  num,
} from "starknet";
import {
  generatePrivateKey,
  privateKeyToAccount,
} from "viem/accounts";
import {
  getAddress,
  padHex,
  parseSignature,
  recoverMessageAddress,
  recoverTypedDataAddress,
} from "viem";
import { createPrivateTransfers, SetupRequirement } from "@starkware-libs/starknet-privacy-sdk";
import { deriveViewingKey } from "@starkware-libs/starknet-privacy-client";
import { Eip712TypedDataSigner } from "@starkware-libs/starknet-privacy-client/signers";

import { resolveNetwork, STRK } from "./lib/networks.mjs";

const PROVER_URL = "https://transaction-prover.alpha-mainnet.sw-dev.io";
const DISCOVERY_URL = "https://discovery-service.alpha-mainnet.sw-dev.io";
const PRIVACY_RPC_URL =
  process.env.STARKNET_PRIVACY_MAINNET_RPC_URL ??
  "https://api.zan.top/public/starknet-mainnet/rpc/v0_10";
const SN_CHAIN_NAME = "SN_MAIN";
/* The domain separator MetaMask would sign against on Ethereum mainnet. It is
   not fetched or verified anywhere on-chain - the account's own validator
   reconstructs the same digest from the calldata it is given, so any value is
   valid as long as signer and account agree on it. 1 is honest: it is what a
   MetaMask user connected to Ethereum mainnet actually has. */
const EVM_CHAIN_ID = 1;

const PROVING_BLOCK_DEPTH = 10;
const PROOF1_VERSION = BigInt("0x50524f4f4631");
const MASK_128 = (BigInt(1) << BigInt(128)) - BigInt(1);

/* Matches the Sepolia sponsored default in app/api/privacy-sdk/deploy/route.ts
   (DEFAULT_SPONSORED_BALANCE). Mainnet's pool fee is 6 STRK versus Sepolia's
   2, so the same 20 STRK target still leaves a comparable gas buffer. */
const FUND_TARGET_BALANCE = BigInt(20) * BigInt(10) ** BigInt(18);
const MAXIMUM_GAS_FEE = BigInt(15) * BigInt(10) ** BigInt(18);

const SUBMIT = process.argv.includes("--submit");
const STATE_FILE = ".secrets/mainnet-eth712-account.json";

function strk(value) {
  return `${(Number(value) / 1e18).toFixed(6)} STRK`;
}

function step(n, text) {
  console.log(`\n[${n}] ${text}`);
}

function felt(value) {
  return `0x${BigInt(value).toString(16)}`;
}

const OWNERSHIP_MESSAGE = "Sign to verify that you own this account.";
const STRK20_ETH712_ACCOUNT_CLASS_HASH =
  "0x697437b25b81bcdd2d1b231d3b8670849fb318555903dbc2fefce2a1a35586e";

/* ------------------------------------------------------------------ *
 * Ported verbatim from lib/privacy/eth712-transaction.ts. Scripts run as
 * plain Node without the app's TypeScript build, so this is a copy, not an
 * import - keep it in sync if the source changes.
 * ------------------------------------------------------------------ */

const ETH712_TRANSACTION_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  Transaction: [
    { name: "calls", type: "Call[]" },
    { name: "metadata", type: "TransactionMetadata" },
  ],
  Call: [
    { name: "address", type: "uint256" },
    { name: "selector", type: "uint256" },
    { name: "data", type: "uint256[]" },
  ],
  TransactionMetadata: [
    { name: "version", type: "uint256" },
    { name: "chain_id", type: "uint256" },
    { name: "execution_resources", type: "uint256[]" },
    { name: "tip", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

const RESOURCE_IDS = {
  l1Gas: BigInt("0x4c315f474153"),
  l2Gas: BigInt("0x4c325f474153"),
  l1Data: BigInt("0x4c315f44415441"),
};

function eth712TransactionTypedData({ accountAddress, calls, details, evmChainId }) {
  const resources = details.resourceBounds;
  const verifyingContract = padHex(felt(BigInt(accountAddress) & MASK_128), {
    size: 20,
  });
  return {
    domain: {
      name: SN_CHAIN_NAME,
      version: "2",
      chainId: BigInt(evmChainId),
      verifyingContract,
    },
    types: ETH712_TRANSACTION_TYPES,
    primaryType: "Transaction",
    message: {
      calls: calls.map((call) => ({
        address: BigInt(call.contractAddress),
        selector: BigInt(hash.getSelectorFromName(call.entrypoint)),
        data: CallData.toCalldata(call.calldata).map(BigInt),
      })),
      metadata: {
        version: BigInt(details.version),
        chain_id: BigInt(details.chainId),
        execution_resources: [
          RESOURCE_IDS.l1Gas,
          resources.l1_gas.max_amount,
          resources.l1_gas.max_price_per_unit,
          RESOURCE_IDS.l2Gas,
          resources.l2_gas.max_amount,
          resources.l2_gas.max_price_per_unit,
          RESOURCE_IDS.l1Data,
          resources.l1_data_gas.max_amount,
          resources.l1_data_gas.max_price_per_unit,
        ],
        tip: BigInt(details.tip),
        nonce: BigInt(details.nonce),
      },
    },
  };
}

function ethSignatureToAccountFelts(signature, evmChainId) {
  const { r, s, yParity } = parseSignature(signature);
  const rValue = BigInt(r);
  const sValue = BigInt(s);
  return [
    rValue >> BigInt(128),
    rValue & MASK_128,
    sValue >> BigInt(128),
    sValue & MASK_128,
    BigInt(27 + yParity),
    BigInt(evmChainId),
  ].map(num.toHex);
}

function resourceCost(bounds) {
  return (
    bounds.l1_gas.max_amount * bounds.l1_gas.max_price_per_unit +
    bounds.l2_gas.max_amount * bounds.l2_gas.max_price_per_unit +
    bounds.l1_data_gas.max_amount * bounds.l1_data_gas.max_price_per_unit
  );
}

function eth712FundedResourceBounds({ estimated, publicBalance, transferAmount, maximumFeeCap }) {
  const nonL2Fee =
    estimated.l1_gas.max_amount * estimated.l1_gas.max_price_per_unit +
    estimated.l1_data_gas.max_amount * estimated.l1_data_gas.max_price_per_unit;
  const available = publicBalance - transferAmount - nonL2Fee;
  if (available <= BigInt(0)) throw new Error("Insufficient public STRK for Eth712 validation");

  const l2Price = estimated.l2_gas.max_price_per_unit;
  if (l2Price <= BigInt(0)) throw new Error("RPC returned an invalid L2 gas price");

  const balanceL2Budget = (available * BigInt(9)) / BigInt(10);
  const cappedL2Budget = maximumFeeCap === undefined ? balanceL2Budget : maximumFeeCap - nonL2Fee;
  if (cappedL2Budget <= BigInt(0)) throw new Error("Gas cap is below the non-L2 fee estimate");
  const l2Budget = balanceL2Budget < cappedL2Budget ? balanceL2Budget : cappedL2Budget;
  const maxAmount = l2Budget / l2Price;
  if (maxAmount <= estimated.l2_gas.max_amount) {
    throw new Error("Insufficient public STRK for Eth712 account validation");
  }

  const provisional = { ...estimated, l2_gas: { ...estimated.l2_gas, max_amount: maxAmount } };
  if (resourceCost(provisional) + transferAmount > publicBalance) {
    throw new Error("Validation resource cap exceeds the public STRK balance");
  }
  if (maximumFeeCap !== undefined && resourceCost(provisional) > maximumFeeCap) {
    throw new Error("Validation resource cap exceeds the configured gas limit");
  }
  return provisional;
}

class Eth712TransactionSigner extends SignerInterface {
  constructor(options) {
    super();
    this.options = options;
  }
  async signTransaction(calls, details) {
    const signature = await this.options.signTypedData(
      eth712TransactionTypedData({
        accountAddress: this.options.accountAddress,
        calls,
        details,
        evmChainId: this.options.evmChainId,
      }),
    );
    return ethSignatureToAccountFelts(signature, this.options.evmChainId);
  }
  async getPubKey() {
    throw new Error("getPubKey is not supported");
  }
  async signMessage() {
    throw new Error("signMessage is not supported");
  }
  async signDeclareTransaction() {
    throw new Error("signDeclareTransaction is not supported");
  }
  async signDeployAccountTransaction() {
    throw new Error("signDeployAccountTransaction is not supported");
  }
}

/* Ported from lib/privacy/evm-strk20-account.ts - the pool CallSet signature
   the STRK20-compatible Eth712 account validates via is_valid_signature. */
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

function approvalCall(poolAddress, amount) {
  const value = cairo.uint256(amount);
  return {
    contractAddress: STRK,
    entrypoint: "approve",
    calldata: [poolAddress, value.low.toString(), value.high.toString()],
  };
}

/* Domain-binds the derived viewing key to this app, this Starknet chain, this
   pool, and this factory - mirrors lib/privacy/eip712-test.ts's
   privacyKeyTypedData, with mainnet's pool and factory instead of Sepolia's. */
function privacyKeyTypedData({ evmAddress, evmChainId, privacyPool, accountFactory }) {
  return {
    domain: { name: "MorokPay Privacy Access", version: "1", chainId: evmChainId },
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
      privacyPool,
      accountFactory,
    },
  };
}

/* ------------------------------------------------------------------ */

const passphrase = process.env.MOROK_VIEWING_PASSPHRASE;
if (!passphrase) {
  console.error("MOROK_VIEWING_PASSPHRASE is not set. It derives the viewing key.");
  process.exit(1);
}

const network = resolveNetwork("mainnet");
const provider = new RpcProvider({ nodeUrl: PRIVACY_RPC_URL, specVersion: "0.10.3" });

const deployments = JSON.parse(readFileSync(network.contractsFile, "utf8"));
const factoryAddress = deployments.accountFactory;
if (!factoryAddress) {
  throw new Error(
    `No accountFactory in ${network.contractsFile}. Run scripts/deploy-eth712-factory.mjs --submit first.`,
  );
}

const accountsStore = JSON.parse(readFileSync(network.accountsFile, "utf8"));
const relayerEntry = accountsStore.accounts.find((item) => item.role === "deployer");
const relayer = new Account({
  provider,
  address: relayerEntry.address,
  signer: relayerEntry.privateKey,
  cairoVersion: "1",
});

/* Persist the local EVM key so a rerun reuses the same account instead of
   minting a new one each time. Same custody note as everywhere else in this
   repo: this is a plaintext key on disk, fine for a throwaway test account,
   never for one holding real funds. */
let evmPrivateKey;
if (existsSync(STATE_FILE)) {
  evmPrivateKey = JSON.parse(readFileSync(STATE_FILE, "utf8")).evmPrivateKey;
  console.log(`Reusing local EVM key from ${STATE_FILE}`);
} else {
  evmPrivateKey = generatePrivateKey();
  writeFileSync(STATE_FILE, JSON.stringify({ evmPrivateKey }, null, 2));
  console.log(`Generated a new local EVM key, saved to ${STATE_FILE}`);
}
const evmAccount = privateKeyToAccount(evmPrivateKey);
const evmAddress = evmAccount.address;

async function checkedSignTypedData(typedData) {
  const signature = await evmAccount.signTypedData(typedData);
  const recovered = await recoverTypedDataAddress({ ...typedData, signature });
  if (recovered.toLowerCase() !== evmAddress.toLowerCase()) {
    throw new Error(`Local signer produced ${recovered}, expected ${evmAddress}`);
  }
  return signature;
}

console.log("MorokPay mainnet Eth712 (MetaMask-path) probe");
console.log(`  evm address    : ${evmAddress}`);
console.log(`  factory        : ${factoryAddress}`);
console.log(`  pool           : ${network.pool}`);
console.log(`  mode           : ${SUBMIT ? "SUBMIT - this spends real STRK" : "estimate only"}`);

/* ------------------------------------------------------------------ *
 * 1. Where does this EVM address land, and is it there already?
 * ------------------------------------------------------------------ */
step(1, "Deterministic account address");

const [expected] = await provider.callContract({
  contractAddress: factoryAddress,
  entrypoint: "get_expected_account_address",
  calldata: [felt(BigInt(evmAddress))],
});
const starknetAddress = num.toHex(BigInt(expected));
console.log(`  ${evmAddress} -> ${starknetAddress}`);

const deployedClassHash = await provider.getClassHashAt(starknetAddress).catch(() => null);
const isDeployed = Boolean(deployedClassHash);
console.log(`  deployed: ${isDeployed ? `yes, class ${deployedClassHash}` : "no"}`);
if (isDeployed && BigInt(deployedClassHash) !== BigInt(STRK20_ETH712_ACCOUNT_CLASS_HASH)) {
  throw new Error(`Deployed with an unexpected class ${deployedClassHash}.`);
}

/* ------------------------------------------------------------------ *
 * 2. Deploy through the factory, funded by the relayer in one call.
 * ------------------------------------------------------------------ */
if (!isDeployed) {
  step(2, "Deploying through the factory");

  const ownershipSignature = await evmAccount.signMessage({ message: OWNERSHIP_MESSAGE });
  const verified = await recoverMessageAddress({
    message: OWNERSHIP_MESSAGE,
    signature: ownershipSignature,
  });
  if (verified.toLowerCase() !== evmAddress.toLowerCase()) {
    throw new Error("Ownership signature did not recover to the EVM address.");
  }
  console.log("  ownership signature verified locally");

  const { r, s, yParity } = parseSignature(ownershipSignature);
  const rValue = BigInt(r);
  const sValue = BigInt(s);
  const deployCall = {
    contractAddress: factoryAddress,
    entrypoint: "deploy_account",
    calldata: [
      felt(BigInt(evmAddress)),
      felt(rValue & MASK_128),
      felt(rValue >> BigInt(128)),
      felt(sValue & MASK_128),
      felt(sValue >> BigInt(128)),
      felt(BigInt(yParity)),
    ],
  };

  const fundTransfer = {
    contractAddress: STRK,
    entrypoint: "transfer",
    calldata: (() => {
      const v = cairo.uint256(FUND_TARGET_BALANCE);
      return [starknetAddress, v.low.toString(), v.high.toString()];
    })(),
  };

  const calls = [fundTransfer, deployCall];
  const estimate = await relayer.estimateInvokeFee(calls, { skipValidate: true, tip: BigInt(0) });
  console.log(`  funding + deploy estimated fee ${strk(estimate.overall_fee)}`);
  console.log(`  will fund the new account with ${strk(FUND_TARGET_BALANCE)}`);

  if (SUBMIT) {
    const submission = await relayer.execute(calls, { resourceBounds: estimate.resourceBounds });
    console.log(`  tx ${submission.transaction_hash}`);
    const receipt = await provider.waitForTransaction(submission.transaction_hash);
    console.log(`  ${receipt.execution_status ?? "done"}`);
    const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    state.starknetAddress = starknetAddress;
    state.deployTx = submission.transaction_hash;
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } else {
    console.log("\nEstimate only. Add --submit to deploy.");
    process.exit(0);
  }
} else {
  step(2, "Deploying through the factory");
  console.log("  already deployed - skipping");
}

/* ------------------------------------------------------------------ *
 * 3. Register the deployed account in the mainnet pool.
 * ------------------------------------------------------------------ */
step(3, "Pool registration state");

const [registeredKey] = await provider.callContract({
  contractAddress: network.pool,
  entrypoint: "get_public_key",
  calldata: [starknetAddress],
});
if (BigInt(registeredKey) !== BigInt(0)) {
  console.log(`  already registered: ${registeredKey}`);
  console.log("\nNothing left to do. This account is a live mainnet MetaMask-path participant.");
  process.exit(0);
}
console.log("  not registered");

const [feeLow, feeHigh] = await provider.callContract({
  contractAddress: network.pool,
  entrypoint: "get_fee_amount",
  calldata: [],
});
const poolFee = BigInt(feeLow) + (BigInt(feeHigh ?? "0x0") << BigInt(128));

const [balanceLow] = await provider.callContract({
  contractAddress: STRK,
  entrypoint: "balance_of",
  calldata: [starknetAddress],
});
const publicBalance = BigInt(balanceLow);
console.log(`  account public balance ${strk(publicBalance)}, pool fee ${strk(poolFee)}`);

step(4, "Deriving the viewing key from an EIP-712 signature");

const privacyKeyRequest = privacyKeyTypedData({
  evmAddress,
  evmChainId: EVM_CHAIN_ID,
  privacyPool: BigInt(network.pool),
  accountFactory: BigInt(factoryAddress),
});
const privacyKeySignature = await checkedSignTypedData(privacyKeyRequest);
const viewingKey = BigInt(deriveViewingKey(privacyKeySignature, starknetAddress));
console.log("  viewing key derived (not printed)");

step(5, "Requesting a registration proof from the mainnet prover");

const callSetSigner = new Eip712TypedDataSigner({
  accountAddress: starknetAddress,
  snChainName: SN_CHAIN_NAME,
  evmChainId: EVM_CHAIN_ID,
  signTypedData: async (typedData) => checkedSignTypedData(normalizedCallSet(typedData)),
});

const transfers = createPrivateTransfers({
  account: { address: starknetAddress, signer: callSetSigner },
  viewingKeyProvider: { getViewingKey: async () => viewingKey },
  provingProvider: {
    url: PROVER_URL,
    chainId: constants.StarknetChainId.SN_MAIN,
    nodeUrl: PRIVACY_RPC_URL,
    ohttp: true,
  },
  discoveryProvider: { url: DISCOVERY_URL },
  poolContractAddress: network.pool,
});

const requirement = await transfers.discoverRequirement(starknetAddress, STRK);
console.log(`  discoverRequirement(STRK) -> ${SetupRequirement[requirement] ?? requirement}`);
if (requirement !== SetupRequirement.Register) {
  console.log("  Unexpected requirement state. Stopping rather than guessing.");
  process.exit(1);
}

const head = await provider.getBlockNumber();
const provingBlock = head - PROVING_BLOCK_DEPTH;
const invocation = await transfers
  .build()
  .register()
  .createProofInvocation({ provingBlockId: provingBlock });
const result = await transfers.executeWithInvocation(invocation, provingBlock);
const { callAndProof } = result;

if (!callAndProof.proof.proofFacts.length) throw new Error("No proof facts returned.");
if (BigInt(callAndProof.proof.proofFacts[0]) !== PROOF1_VERSION) {
  throw new Error(`Unexpected proof version ${callAndProof.proof.proofFacts[0]}.`);
}
console.log(
  `  proof OK - ${callAndProof.proof.data.length} felts, ${callAndProof.proof.proofFacts.length} facts, PROOF1`,
);

step(6, "Signing and submitting the account's own InvokeV3");

const eth712TxSigner = new Eth712TransactionSigner({
  accountAddress: starknetAddress,
  evmChainId: EVM_CHAIN_ID,
  signTypedData: checkedSignTypedData,
});
const eth712Account = new Account({
  provider,
  address: starknetAddress,
  signer: eth712TxSigner,
  cairoVersion: "1",
});

const calls = [approvalCall(network.pool, poolFee), callAndProof.call];
const proofDetails = { proof: callAndProof.proof.data, proofFacts: callAndProof.proof.proofFacts };

const nonce = BigInt(await eth712Account.getNonce());
const estimate = await eth712Account.estimateInvokeFee(calls, {
  nonce,
  skipValidate: true,
  tip: BigInt(0),
  ...proofDetails,
});
const resourceBounds = eth712FundedResourceBounds({
  estimated: estimate.resourceBounds,
  publicBalance,
  transferAmount: poolFee,
  maximumFeeCap: MAXIMUM_GAS_FEE,
});
console.log(`  estimated ceiling within cap ${strk(MAXIMUM_GAS_FEE)}`);

if (!SUBMIT) {
  console.log("\nEstimate only. Nothing was submitted. Add --submit to register on mainnet.");
  process.exit(0);
}

const submission = await eth712Account.execute(calls, {
  nonce,
  resourceBounds,
  tip: BigInt(0),
  ...proofDetails,
});
console.log(`  tx ${submission.transaction_hash}`);
console.log(`  ${network.explorer}/tx/${submission.transaction_hash}`);

const receipt = await provider.waitForTransaction(submission.transaction_hash);
console.log(`  execution status: ${receipt.execution_status ?? "see explorer"}`);

const [after] = await provider.callContract({
  contractAddress: network.pool,
  entrypoint: "get_public_key",
  calldata: [starknetAddress],
});

const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
state.starknetAddress = starknetAddress;
state.registerTx = submission.transaction_hash;
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

console.log(`  pool get_public_key after: ${after}`);
console.log(
  BigInt(after) === BigInt(0)
    ? "\n  Registration did not take. Read the receipt before retrying."
    : "\n  A MetaMask-derived account is now a registered mainnet STRK20 participant.\n  Add this hash to strk20.json.",
);
