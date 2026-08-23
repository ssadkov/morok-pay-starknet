# Handoff

MorokPay is a **private donation** product on Starknet for the STRK20 Private
Sprint. The sprint cut is not a generic wallet and not a merchant checkout.

## Focus (2026-08-23)

1. **Donation UI** — creator QR and supporter pay screen. Do this next.
2. **First 10 contest** — ten registered Ready accounts, all paid privately
   from a 30 USDC pool. [private-first-10.md](private-first-10.md).
3. **DonationPot, if time** — anonymous jar with a public total; creator sweeps
   into a shielded note. Design: [donation-pot.md](donation-pot.md). No Cairo
   until 1 and 2 are done.

A private donation is `wallet_strk20InvokeTransaction` `{ type: "transfer" }`.
No helper on that path. Invoice/sale remain parseable so old links still pay;
do not add them back as first-class creator flows.

## Product thesis

The creator publishes one durable QR with an empty amount. A supporter opens
it, chooses how much, confirms in Ready. The transfer stays in the pool.

The First 10 contest is the same loop run in public: connect Ready, shield
once, generate a Donation QR, get paid privately. That is wallet activation
plus a real recipient, not unique humanity. Social rules still handle bots.

## Locked technical boundary

Ready holds the viewing key. MorokPay uses Wallet API methods for private
balances and private transfers. It does not extract keys or call the hosted
prover directly.

Ready exposes balances, not private transfer history. Therefore:

- labels and references remain in the QR and local browser storage;
- the creator refreshes private balance and explicitly marks a donation
  received;
- the deployed `MorokInvoices` event is not trusted as settlement proof;
- an empty-note helper cannot prove the hidden recipient, token, or amount of a
  separate transfer action. See [private-invoices.md](private-invoices.md).

## App map

- `/` — pay or get paid.
- `/pay` — scan/paste request, optionally choose donation amount, private pay.
- `/sell` — current UI still offers invoice, sale, donation, and Private Drop.
  The donation-UI pass should lead with Donation (open amount) and stop
  presenting the rest as equal doors.
- `/treasury` — Base CCTP top-up, shield, private balances, payout.
- invoices and MorokPay activity are stored locally.

Default network is controlled by `NEXT_PUBLIC_STARKNET_NETWORK`; the header can
switch between Sepolia and mainnet. Pool fee is read from `get_fee_amount` (last
verified: 2 STRK on Sepolia and 6 STRK on mainnet).

## Submission state

- Ready wallet with pool activity:
  [`0x00e5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423`](https://voyager.online/contract/0x00e5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423)
- `strk20.json` lists three succeeded mainnet pool txs. Deposit events on
  those txs name the Ready wallet above. The Starknet `sender_address` is the
  relayer — do not treat it as the user.
- Live demo: https://morok-pay-starknet.vercel.app
- 3-minute video: missing. Required to be scored.
- Do not list `MorokInvoices` as payment integration.
- Replace the public unauthenticated RPC with a keyed endpoint before contest
  traffic.

## Safety

- Never commit `.secrets/` or funded keys.
- Sepolia transactions are not hackathon mainnet evidence.
- Do not describe a payment request, local status, or `InvoiceSettled` event as
  cryptographic proof of payment.
- Do not attribute a private transfer to the Starknet transaction sender. That
  account is the relayer. A **deposit** (shield) is public and names the
  shielding Ready address as the first indexed key of the pool `Deposit` event.
- Do not promise that DonationPot hides the fact of a sweep; it hides the
  destination note owner. Unshield and CCTP are public again.
