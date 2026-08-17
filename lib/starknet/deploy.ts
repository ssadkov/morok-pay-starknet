import { Account } from "starknet";

import { OZ_ACCOUNT_CLASS_HASH } from "./constants";
import { ozConstructorCalldata, type DerivedTreasury } from "./derive";
import { createProvider } from "./status";

export function createTreasuryAccount(treasury: DerivedTreasury) {
  return new Account({
    provider: createProvider(),
    address: treasury.address,
    signer: treasury.privateKey,
    cairoVersion: "1",
  });
}

export async function deployTreasuryAccount(treasury: DerivedTreasury) {
  const account = createTreasuryAccount(treasury);
  const payload = {
    classHash: OZ_ACCOUNT_CLASS_HASH,
    constructorCalldata: ozConstructorCalldata(treasury.publicKey),
    addressSalt: treasury.publicKey,
    contractAddress: treasury.address,
  };

  const response = await account.deployAccount(payload, {
    tip: BigInt(0),
  });

  await account.provider.waitForTransaction(response.transaction_hash);
  return response;
}
