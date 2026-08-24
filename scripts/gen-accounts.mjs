/**
 * Generates Starknet accounts for contract work.
 *
 * These are plain OpenZeppelin accounts. They can deploy contracts, hold public
 * USDC, and receive payouts — they cannot shield or transfer privately, because
 * STRK20 proving is IP-whitelisted to Ready and Xverse.
 *
 * Keys land in .secrets/<network>-accounts.json, which is gitignored. On
 * mainnet these hold real funds, so treat that file as a wallet.
 *
 * Usage:
 *   node scripts/gen-accounts.mjs            // sepolia
 *   node scripts/gen-accounts.mjs mainnet
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { CallData, ec, encode, hash } from "starknet";

import { OZ_CLASS_HASH, resolveNetwork } from "./lib/networks.mjs";

const network = resolveNetwork(process.argv[2]);

const ROLES = [
  { role: "deployer", purpose: "declare and deploy MorokEscrow" },
  { role: "payout", purpose: "fresh recipient for unshield / payout tests" },
  { role: "spare", purpose: "second recipient, or a backup deployer" },
];

if (existsSync(network.accountsFile)) {
  console.error(
    `${network.accountsFile} already exists. Delete it first if you really want new keys.`,
  );
  process.exit(1);
}

const accounts = ROLES.map(({ role, purpose }) => {
  const privateKey = encode.addHexPrefix(
    encode.buf2hex(ec.starkCurve.utils.randomPrivateKey()),
  );
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const constructorCalldata = CallData.compile({ publicKey });
  const address = hash.calculateContractAddressFromHash(
    publicKey,
    OZ_CLASS_HASH,
    constructorCalldata,
    0,
  );
  return { role, purpose, address, publicKey, privateKey };
});

mkdirSync(".secrets", { recursive: true });
writeFileSync(
  network.accountsFile,
  `${JSON.stringify(
    { network: network.name, classHash: OZ_CLASS_HASH, accounts },
    null,
    2,
  )}\n`,
);

console.log(
  `Fund these ${network.name} addresses, then run scripts/deploy-account.mjs:\n`,
);
for (const account of accounts) {
  console.log(`${account.role.padEnd(9)} ${account.address}`);
  console.log(`          ${account.purpose}\n`);
}
console.log(`Keys written to ${network.accountsFile} (gitignored).`);
