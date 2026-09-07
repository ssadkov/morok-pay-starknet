import { escrowClaimFelt } from "./escrow-claim-intent";

/** Decode the ServerAction ABI shipped with the pinned STRK20 SDK RC.5.
 * Fail closed on unknown variants and public transfers/registration/channel
 * setup. A refund must create one private open note and invoke this escrow.
 * In particular, substring-searching calldata is NOT an authorization check.
 */
export function refundNoteFromCalldata(args: {
  calldata: unknown;
  escrow: string;
  commitment: string;
  token: string;
}): string {
  if (!Array.isArray(args.calldata) || args.calldata.length > 4096) {
    throw new Error("Invalid refund pool calldata");
  }
  const data = args.calldata.map(escrowClaimFelt);
  let cursor = 0;
  const take = () => {
    if (cursor >= data.length) throw new Error("Truncated refund pool calldata");
    return data[cursor++];
  };
  const span = () => {
    const length = BigInt(take());
    if (length > BigInt(data.length - cursor)) throw new Error("Truncated refund span");
    return Array.from({ length: Number(length) }, take);
  };
  const count = BigInt(take());
  if (count > 128n) throw new Error("Too many refund actions");
  let note: string | undefined;
  let invokedNote: string | undefined;
  for (let i = 0n; i < count; i++) {
    const variant = BigInt(take());
    switch (variant) {
      case 0n: // WriteOnce(storage_address, Span<felt>)
        take(); span(); break;
      case 7n: { // EmitOpenNoteCreated(enc_recipient_addr: 3 felts, token, note_id)
        take(); take(); take();
        const token = take();
        const id = take();
        if (note !== undefined || BigInt(token) !== BigInt(args.token) || BigInt(id) === 0n) {
          throw new Error("Refund must create exactly one note of the escrow token");
        }
        note = id;
        break;
      }
      case 8n: // EmitEncNoteCreated(note_id, packed_value)
        take(); take(); break;
      case 9n: // EmitNoteUsed(nullifier)
        take(); break;
      case 10n: { // Invoke(contract_address, Span<felt>)
        const target = take();
        const calldata = span();
        if (invokedNote !== undefined || BigInt(target) !== BigInt(args.escrow) ||
            calldata.length !== 9 || BigInt(calldata[0]) !== 1n ||
            BigInt(calldata[2]) !== BigInt(args.commitment) ||
            calldata.slice(3).some((v) => BigInt(v) !== 0n)) {
          throw new Error("Only this entry's private refund is sponsored");
        }
        invokedNote = calldata[1];
        break;
      }
      default:
        throw new Error("Refund proof contains public setup, a transfer, or an unsupported action");
    }
  }
  // apply_actions(actions, screening: None). Refunds make no screened deposit.
  if (BigInt(take()) !== 1n || cursor !== data.length) {
    throw new Error("Unexpected refund screening or trailing calldata");
  }
  if (!note || !invokedNote || BigInt(note) !== BigInt(invokedNote)) {
    throw new Error("Refund invocation does not name the note created by its proof");
  }
  return note;
}
