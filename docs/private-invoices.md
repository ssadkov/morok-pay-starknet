# Private payment requests and reconciliation

## Current security boundary

A MorokPay QR is a payment request. It may contain the recipient Ready address,
an amount, a local reference, a label, and a request type. The payer submits a
normal STRK20 private transfer. The label and reference are not sent to the pool.

The deployed `MorokInvoices` helper is **not used as payment proof**. Its
`privacy_invoke` entry point can verify that the pool called the helper, but an
empty-note helper cannot verify that a second action in the same private
transaction transferred a particular token or amount to a particular hidden
recipient. Anyone who knows a commitment could therefore emit the same receipt
without paying the intended merchant.

Consequences:

- the app never marks an invoice paid from `InvoiceSettled`;
- the merchant refreshes their private balance and confirms the matching local
  sale as paid;
- a historical `settledTx` may still be displayed for old local records, but is
  not presented as cryptographic settlement proof;
- `MorokInvoices` should not be listed as a core contest integration until a
  helper can bind settlement to authenticated private note data.

## Request types

- **Sale** is the only request created by the current seller interface: product,
  fixed USDC price, and an automatically generated reference.
- Previously shared Invoice and Donation links remain parseable for backwards
  compatibility, but they are not offered as new seller workflows.

## What is private

The STRK20 transfer hides the transferred amount and recipient relationship from
ordinary on-chain observers. It does not make everything around the payment
private:

- the Ready account submitting the pool transaction is public;
- anyone who sees a QR can read the recipient address, fixed amount, label, and
  reference encoded in that QR;
- publishing a QR in a video intentionally makes those request fields public;
- MorokPay activity and sale status are local browser records, not private
  history supplied by Ready.

For a creator donation QR, omit the amount and use a generic label. This gives
the creator one durable link while keeping each supporter's chosen amount out of
the shared QR.

## Future cross-device reconciliation

Do not revive the old opaque-commitment event without a binding proof. Safe
directions are:

1. an STRK20/Wallet API receipt primitive authenticated to the output note;
2. a helper that receives authenticated open-note data and enforces token,
   recipient channel, and amount before emitting a receipt;
3. an encrypted merchant inbox where each payer creates a fresh ciphertext,
   avoiding a static public event shared by everyone scanning the same QR.

Until one exists, balance refresh plus explicit merchant confirmation is the
honest product boundary.

### Candidate: invoice-bound open note

A replacement `MorokInvoices` can be useful if the invoice is bound to a
merchant-created open note instead of trying to infer the recipient from a
separate private transfer:

1. The merchant creates an open USDC note owned by their registered Ready and
   obtains its `note_id`.
2. The QR commits to `invoice nonce + note_id + token + exact amount`.
3. The payer withdraws the exact private amount to the helper and invokes it
   with that committed data.
4. The helper verifies the commitment and replay status, approves the pool,
   and returns an `OpenNoteDeposit` for that exact `note_id`, token, and amount.
5. Only then does it emit a settlement event and mark the commitment paid.

This would bind the receipt to actual funds credited into the merchant-selected
note and prevent a payer from settling the same invoice into their own note.
It also makes the open-note token, amount, note ID, timing, and invoice
commitment public. The recipient remains encrypted at the pool level.

This design is not implemented or proven in Ready yet. Before writing the
replacement contract, test on Sepolia that Ready can create a standalone open
note, expose its `note_id` to the app, and later accept a helper deposit into
that existing note. If the Wallet API only supports same-transaction open-note
placeholders, this design needs upstream wallet support rather than a Cairo-only
workaround.
