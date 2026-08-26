import { Account, CallData, RpcProvider, ec, hash } from "starknet";

const RPC_URL = "https://api.zan.top/public/starknet-sepolia";
const STRK_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ACCOUNT_CLASS_HASH =
  "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";

const privateKey = process.env.MOROKPAY_DEPLOY_PRIVATE_KEY?.trim();
const expectedAddress = process.env.MOROKPAY_DEPLOY_EXPECTED_ADDRESS?.trim();

if (!privateKey || !expectedAddress) {
  throw new Error("Private key or relayer address was not provided.");
}

const provider = new RpcProvider({ nodeUrl: RPC_URL });

function normalizeAddress(address) {
  return `0x${BigInt(address).toString(16).padStart(64, "0")}`;
}

function formatStrk(value) {
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n)
    .toString()
    .padStart(18, "0")
    .slice(0, 4);
  return `${whole}.${fraction}`;
}

async function getBalance(address) {
  const result = await provider.callContract({
    contractAddress: STRK_ADDRESS,
    entrypoint: "balance_of",
    calldata: [address],
  });
  return BigInt(result[0]) + (BigInt(result[1] ?? "0x0") << 128n);
}

async function isDeployed(address) {
  try {
    await provider.getClassHashAt(address);
    return true;
  } catch {
    return false;
  }
}

const publicKey = ec.starkCurve.getStarkKey(privateKey);
const constructorCalldata = CallData.compile([publicKey]);
const derivedAddress = hash.calculateContractAddressFromHash(
  publicKey,
  ACCOUNT_CLASS_HASH,
  constructorCalldata,
  0,
);

const actual = normalizeAddress(derivedAddress);
const expected = normalizeAddress(expectedAddress);

if (actual !== expected) {
  throw new Error(
    `Private key does not match the relayer address.\nExpected: ${expected}\nDerived:  ${actual}`,
  );
}

console.log(`Private key matches address: ${actual}`);

if (await isDeployed(actual)) {
  console.log("Account is already deployed; nothing to do.");
  process.exit(0);
}

const balance = await getBalance(actual);
console.log(`Balance: ${formatStrk(balance)} STRK`);

if (balance < 5n * 10n ** 18n) {
  throw new Error(`Fund ${actual} with at least 5 Sepolia STRK, then retry.`);
}

const account = new Account({ provider, address: actual, signer: privateKey });
console.log("Submitting deployment...");

const deployment = await account.deployAccount({
  classHash: ACCOUNT_CLASS_HASH,
  constructorCalldata,
  addressSalt: publicKey,
});

console.log(
  `Deployment submitted: https://sepolia.voyager.online/tx/${deployment.transaction_hash}`,
);
await provider.waitForTransaction(deployment.transaction_hash);
console.log(`RELAYER DEPLOYED: ${actual}`);
console.log(`Transaction: ${deployment.transaction_hash}`);
