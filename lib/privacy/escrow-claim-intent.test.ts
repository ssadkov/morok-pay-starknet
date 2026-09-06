import { describe, expect, it } from "vitest";
import { hash } from "starknet";
import { privateKeyToAccount } from "viem/accounts";
import { signEphemeralClaim } from "./ephemeral-claimer";
import { escrowClaimFelt, verifyEscrowClaimIntent } from "./escrow-claim-intent";

const seed = `0x${"11".repeat(32)}` as const;
const other = `0x${"22".repeat(32)}` as const;
const now = 1_800_000_000n;
const args = {
  network: "sepolia" as const, escrow: "0x123", commitment: "0x456",
  accountAddress: "0x789", evmAddress: privateKeyToAccount(seed).address,
  relayer: "0xabc", now,
};
async function signed(key = seed as `0x${string}`, entrypoint = "claim", target = "0x987") {
  return (await signEphemeralClaim({
    seed: key, starknetAddress: args.accountAddress, snChainName: "SN_SEPOLIA",
    evmChainId: 11155111, caller: args.relayer, executeBefore: Number(now + 300n),
    call: { to: args.escrow, selector: hash.getSelectorFromName(entrypoint), calldata: [args.commitment, target] },
  })).calldata;
}

describe("escrow sponsorship authorization", () => {
  it("accepts the owner's signed claim with its exact destination", async () => {
    const calldata = await signed();
    expect(await verifyEscrowClaimIntent({ ...args, calldata })).toEqual(calldata);
  });
  it.each([
    [0, "0x999", "another relayer"], [4, "0x2", "multiple calls"],
    [5, "0x999", "another contract"], [6, hash.getSelectorFromName("balance_of"), "another entrypoint"],
    [7, "0x3", "extra arguments"], [8, "0x999", "another commitment"],
    [9, "0x999", "a substituted destination"], [9, "0x0", "a zero destination"],
    [10, "0x5", "a truncated signature"], [15, "0x0", "invalid recovery parity"],
    [16, "0x1", "a changed EVM signing domain"],
    [3, `0x${now.toString(16)}`, "an expired intent"],
    [3, `0x${(now + 901n).toString(16)}`, "an excessively long intent"],
    [2, `0x${now.toString(16)}`, "a not-yet-executable intent"],
  ])("refuses %s=%s (%s) before submission", async (index, value) => {
    const calldata = await signed();
    calldata[index as number] = value as string;
    await expect(verifyEscrowClaimIntent({ ...args, calldata })).rejects.toThrow();
  });
  it("refuses a legitimate signature from a different key", async () => {
    await expect(verifyEscrowClaimIntent({ ...args, calldata: await signed(other) })).rejects.toThrow(/signature/);
  });
  it("refuses the same intent on another Starknet network or account", async () => {
    const calldata = await signed();
    await expect(verifyEscrowClaimIntent({ ...args, network: "mainnet", calldata })).rejects.toThrow(/signature/);
    await expect(verifyEscrowClaimIntent({ ...args, accountAddress: "0x999", calldata })).rejects.toThrow(/signature/);
  });
  it("refuses trailing data and out-of-range field elements", async () => {
    await expect(verifyEscrowClaimIntent({ ...args, calldata: [...await signed(), "0x0"] })).rejects.toThrow();
    expect(() => escrowClaimFelt(`0x${"ff".repeat(32)}`)).toThrow(/range/);
  });
  it("binds refund authorization to the exact note in the private proof", async () => {
    const calldata = await signed(seed, "authorize_refund", "0x1234");
    await expect(verifyEscrowClaimIntent({ ...args, calldata, refundNote: "0x1234" })).resolves.toEqual(calldata);
    await expect(verifyEscrowClaimIntent({ ...args, calldata, refundNote: "0x1235" })).rejects.toThrow(/note/);
    await expect(verifyEscrowClaimIntent({ ...args, calldata })).rejects.toThrow();
  });
});
