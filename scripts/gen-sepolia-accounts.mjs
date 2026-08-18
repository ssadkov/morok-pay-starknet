/**
 * Generates throwaway Starknet Sepolia accounts for local testing.
 *
 * These are plain OpenZeppelin accounts. They can deploy contracts, hold public
 * USDC, and receive payouts — they cannot shield or transfer privately, because
 * STRK20 proving is IP-whitelisted to Ready and Xverse.
 *
 * Keys land in .secrets/sepolia-accounts.json, which is gitignored.
 *
 * Usage: node scripts/gen-sepolia-accounts.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { CallData, ec, encode, hash } from "starknet";

const OZ_CLASS_HASH =
  "0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

const ROLES = [
  { role: "deployer", purpose: "declare and deploy MorokInvoices on Sepolia" },
  { role: "payout", purpose: "fresh recipient for unshield / payout tests" },
  { role: "spare", purpose: "second recipient, or a backup deployer" },
];

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
  ".secrets/sepolia-accounts.json",
  `${JSON.stringify(
    { network: "sepolia", classHash: OZ_CLASS_HASH, accounts },
    null,
    2,
  )}\n`,
);

console.log("Fund these Sepolia addresses, then run scripts/deploy-account.mjs:\n");
for (const account of accounts) {
  console.log(`${account.role.padEnd(9)} ${account.address}`);
  console.log(`          ${account.purpose}\n`);
}
console.log("Keys written to .secrets/sepolia-accounts.json (gitignored).");
