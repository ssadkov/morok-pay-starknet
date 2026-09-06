import { describe, expect, it } from "vitest";
import { CallData, CairoCustomEnum, CairoOption, CairoOptionVariant } from "starknet";
import { PrivacyPoolABI } from "../../node_modules/@starkware-libs/starknet-privacy-sdk/dist/internal/abi";
import { refundNoteFromCalldata } from "./escrow-refund-proof";

const args = { escrow: "0x123", commitment: "0x456", token: "0x789" };
// RC.5 ServerAction::EmitOpenNoteCreated + Invoke, screening None.
export function refundCalldata(escrow = args.escrow, commitment = args.commitment, token = args.token) {
  return ["0x2", "0x7", "0x11", "0x22", "0x33", token, "0x999",
    "0xa", escrow, "0x9", "0x1", "0x999", commitment,
    "0x0", "0x0", "0x0", "0x0", "0x0", "0x0", "0x1"];
}
describe("private refund pool proof policy", () => {
  it("matches calldata compiled from the installed SDK's generated pool ABI", () => {
    const calldata = new CallData(PrivacyPoolABI).compile("apply_actions", {
      actions: [
        new CairoCustomEnum({ EmitOpenNoteCreated: {
          enc_recipient_addr: { auditor_public_key: "0x11", ephemeral_pubkey: "0x22", enc_user_addr: "0x33" },
          token: args.token, note_id: "0x999",
        } }),
        new CairoCustomEnum({ Invoke: { contract_address: args.escrow,
          calldata: ["0x1", "0x999", args.commitment, "0x0", "0x0", "0x0", "0x0", "0x0", "0x0"],
        } }),
      ],
      screening: new CairoOption(CairoOptionVariant.None),
    });
    expect(refundNoteFromCalldata({ ...args, calldata: calldata.map(v => `0x${BigInt(v).toString(16)}`) })).toBe("0x999");
  });
  it("extracts the note from the exact pool action ABI", () => {
    expect(refundNoteFromCalldata({ ...args, calldata: refundCalldata() })).toBe("0x999");
  });
  it.each([
    [1, "0x1"], // publishing a recipient through Append
    [1, "0x4"], // publishing the sender's registration
    [1, "0x3"], // public token transfer
    [5, "0x111"], // another token
    [6, "0x111"], // a different output note
    [7, "0xb"], // compute-and-invoke is not an escrow refund
    [8, "0x111"], // another helper
    [10, "0x0"], // Deposit, not Refund
    [12, "0x111"], // another commitment
    [13, "0x111"], // noncanonical ignored args
    [19, "0x0"], // unexpected screening attestation
  ])("rejects modified calldata at %s", (index, value) => {
    const calldata = refundCalldata(); calldata[index] = value;
    expect(() => refundNoteFromCalldata({ ...args, calldata })).toThrow();
  });
  it("rejects truncated or trailing calldata and oversized spans", () => {
    const calldata = refundCalldata();
    expect(() => refundNoteFromCalldata({ ...args, calldata: calldata.slice(0, -1) })).toThrow();
    expect(() => refundNoteFromCalldata({ ...args, calldata: [...calldata, "0x0"] })).toThrow();
    calldata[9] = "0xffff";
    expect(() => refundNoteFromCalldata({ ...args, calldata })).toThrow();
  });
  it("allows encrypted writes/change/nullifiers, without interpreting ciphertext as an address", () => {
    const base = refundCalldata();
    const calldata = ["0x5", "0x0", "0x101", "0x2", "0x456", "0x123",
      "0x8", "0x102", "0x103", "0x9", "0x104", ...base.slice(1)];
    expect(refundNoteFromCalldata({ ...args, calldata })).toBe("0x999");
  });
});
