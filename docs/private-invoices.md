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
- the merchant refreshes their private balance and marks the local request paid;
- a historical `settledTx` may still be displayed for old local records, but is
  not presented as cryptographic settlement proof;
- `MorokInvoices` should not be listed as a core contest integration until a
  helper can bind settlement to authenticated private note data.

## Request types

- **Invoice** — fixed amount, label, and merchant reference.
- **Sale** — fixed-price point-of-sale QR.
- **Donation** — fixed amount or a reusable open-amount QR. For an open request,
  each supporter chooses the amount after scanning; the public QR stays the same.
- **Private Drop** — open reward request used as a contest entry. Creation is
  enabled only after the app confirms the Ready address has a registered STRK20
  public key in the selected pool.

## What is private

The STRK20 transfer hides the transferred amount and recipient relationship from
ordinary on-chain observers. It does not make everything around the payment
private:

- the Ready account submitting the pool transaction is public;
- anyone who sees a QR can read the recipient address, fixed amount, label, and
  reference encoded in that QR;
- publishing a QR in a video intentionally makes those request fields public;
- MorokPay activity and invoice status are local browser records, not private
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
