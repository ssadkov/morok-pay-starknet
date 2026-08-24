# Handoff

MorokPay is a private donation product on Starknet for the STRK20 Private Sprint. The current sprint cut is not a generic wallet or merchant checkout.

## Current focus (2026-08-25)

1. Donation UI and onboarding are shipped on `master`.
2. Dry-run the First 10 campaign with registered Ready accounts and record the required three-minute submission video.
3. Replace the public unauthenticated mainnet RPC before campaign traffic.
4. Add a downloadable branded QR image with the donation label and MorokPay logo while preserving a reliably scannable payment link.
5. Test MetaMask as the entry wallet and document the exact account, funding, and Ready/private activation boundary.
6. Return to the unshield-fee design after that test; do not charge a MorokPay fee on every private donation. See [fees.md](fees.md).
7. Build DonationPot only if the core submission is complete.

## Product flow

- `/` — choose Donate or My QR.
- `/pay` — open or paste a donation request, choose an amount, and pay privately.
- `/sell` — activate STRK20 and create one reusable open-amount Donation QR.
- `/treasury` — Base CCTP top-up, shield, private balances, and payout.
- `/claim` — compatibility route for previously issued `MorokEscrow` links; it is not linked from the current product UI.

Donation requests and app activity are stored in the current browser. Old invoice, sale, and Drop links remain parseable so existing URLs can still open, but those flows are not presented as product choices.

## Technical boundary

MorokPay uses Ready Wallet API methods for private balances and transactions. Ready owns the viewing key, note discovery, proving, and submission. Do not restore the removed direct Privacy SDK path or ask users for viewing keys.

A donation is a normal `wallet_strk20InvokeTransaction` transfer. No helper contract is involved. Ready exposes balances, not private transfer history, so the creator refreshes the balance and explicitly marks a donation received.

MorokPay's planned service fee belongs at the app's `Unshield` step, not inside each private donation. The current direct-wallet architecture cannot enforce that fee if a user unshields in Ready instead of MorokPay. See [fees.md](fees.md).

The deployed `MorokInvoices` event is not settlement proof: an empty-note helper cannot authenticate the hidden recipient, token, or amount of a separate transfer action. See [private-invoices.md](private-invoices.md).

## Submission state

- Ready wallet with pool activity: `0x00e5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423`.
- `strk20.json` lists three succeeded mainnet pool transactions. Their Starknet sender is the relayer, not the user.
- Live demo: https://morok-pay-starknet.vercel.app
- Three-minute video: missing and required for scoring.
- Mainnet `MorokEscrow`: not deployed. Do not create or advertise mainnet claim links.
- DonationPot: designed, not implemented.

## Safety

- Never commit `.secrets/` or funded keys.
- Do not attribute a private transfer to the Starknet transaction sender.
- Do not describe STRK20 as complete anonymity: deposits, withdrawals, open-note amounts, timing, and app-side actions can be public.
- Do not treat a request, local received status, or `InvoiceSettled` event as cryptographic payment proof.
- Existing claim URLs are bearer secrets. Anyone who learns one can claim its funds.
