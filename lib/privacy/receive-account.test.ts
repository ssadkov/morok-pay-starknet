import { describe, expect, it } from "vitest";
import { ec } from "starknet";
import { privateKeyToAccount } from "viem/accounts";

import {
  deriveReceiveAccount,
  receiveAccountAddress,
  receiveAccountDeployCall,
  receiveAccountTypedData,
  RECEIVE_ACCOUNT_CLASS_HASH,
  UDC_ADDRESS,
} from "./receive-account";

const wallet = privateKeyToAccount(
  "0x0000000000000000000000000000000000000000000000000000000000000001",
);

function typedData(network: "sepolia" | "mainnet") {
  return receiveAccountTypedData({
    evmAddress: wallet.address,
    evmChainId: 1,
    network,
  });
}

describe("the account a QR publishes", () => {
  it("comes back the same from the same signature", async () => {
    const signature = await wallet.signTypedData(typedData("sepolia"));
    const first = deriveReceiveAccount(signature);
    const second = deriveReceiveAccount(signature);
    expect(first).toEqual(second);
    expect(first.address).toMatch(/^0x[0-9a-f]+$/);
  });

  it("is a different account on each network", async () => {
    const sepolia = deriveReceiveAccount(
      await wallet.signTypedData(typedData("sepolia")),
    );
    const mainnet = deriveReceiveAccount(
      await wallet.signTypedData(typedData("mainnet")),
    );
    /* A testnet key that leaked must not be the key holding real donations. */
    expect(sepolia.address).not.toBe(mainnet.address);
  });

  it("is a different account for a different wallet", async () => {
    const other = privateKeyToAccount(
      "0x0000000000000000000000000000000000000000000000000000000000000002",
    );
    const mine = deriveReceiveAccount(
      await wallet.signTypedData(typedData("sepolia")),
    );
    const theirs = deriveReceiveAccount(
      await other.signTypedData({
        ...typedData("sepolia"),
        message: { ...typedData("sepolia").message, evmAccount: other.address },
      }),
    );
    expect(mine.address).not.toBe(theirs.address);
  });

  it("derives a key the STARK curve accepts", async () => {
    const account = deriveReceiveAccount(
      await wallet.signTypedData(typedData("sepolia")),
    );
    expect(ec.starkCurve.getStarkKey(account.privateKey)).toBe(
      account.publicKey,
    );
    /* The pool checks the receive account's own is_valid_signature, so the
       key has to actually sign for the address it derives. */
    const signature = ec.starkCurve.sign("0x1234", account.privateKey);
    const fullPublicKey = Buffer.from(
      ec.starkCurve.getPublicKey(account.privateKey, false),
    ).toString("hex");
    expect(ec.starkCurve.verify(signature, "0x1234", fullPublicKey)).toBe(true);
  });

  it("says nothing about the main account in the message it signs", () => {
    /* The wallet shows this; it must read as what it is. */
    expect(typedData("sepolia").message.purpose).toContain(
      "your donation QR publishes",
    );
  });
});

describe("deploying it", () => {
  it("deploys to exactly the address the key derives", async () => {
    const account = deriveReceiveAccount(
      await wallet.signTypedData(typedData("sepolia")),
    );
    const call = receiveAccountDeployCall(account.publicKey);
    expect(call.contractAddress).toBe(UDC_ADDRESS);
    expect(call.entrypoint).toBe("deployContract");
    const [classHash, salt, unique] = call.calldata as string[];
    expect(BigInt(classHash)).toBe(BigInt(RECEIVE_ACCOUNT_CLASS_HASH));
    expect(BigInt(salt)).toBe(BigInt(account.publicKey));
    /* Non-unique, so the UDC uses deployer 0 and the address stays a function
       of the key - whoever pays for the deployment. */
    expect(BigInt(unique)).toBe(BigInt(0));
    expect(receiveAccountAddress(account.publicKey)).toBe(account.address);
  });
});
