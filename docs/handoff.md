# Handoff

MorokPay is a private merchant checkout on Starknet built for the STRK20
Private Sprint. The focused demo is intentionally simple: a seller enters a
product and fixed USDC price, publishes a QR, receives a private payment, and
tracks whether the sale was paid and fulfilled.

## Product thesis

The first useful vertical is a small merchant such as a coffee stand:

1. Connect a Ready account and activate STRK20 once.
2. Enter `Coffee` and a fixed price.
3. Show or share the generated QR.
4. The buyer pays privately from another Ready account.
5. The seller refreshes their balance, confirms the matching sale, then marks
   the order fulfilled.
6. On the next visit, the seller sees paid sales, revenue, fulfilment count,
   products sold, and the time of each locally recorded sale.

This is stronger than presenting several nearly identical request types. A
unique invoice can be introduced later when it has contract-backed,
cross-device reconciliation rather than being another label on the same QR.

## Current seller lifecycle

The `/sell` page creates only a fixed-price **Sale** with:

- product name;
- USDC price;
- automatically generated local sale reference;
- `Awaiting payment`, `Paid`, and `Fulfilled` states.

`Paid` and `Fulfilled` are deliberately separate. Payment means the seller has
confirmed incoming value; fulfilment means the coffee or other product was
actually handed over. Fulfilment is a local merchant checkbox and does not
submit a blockchain transaction.

The seller dashboard is rebuilt from browser storage on load. It shows only
sales created by the currently connected seller on the selected network.

## Locked technical boundary

Ready holds the viewing key. MorokPay uses Wallet API methods for private
balances and `wallet_strk20InvokeTransaction` for a normal private transfer. It
does not extract keys or call the hosted prover directly.

Ready exposes balances, not private transfer history. Therefore:

- product, reference, timestamps, and status remain in the QR/local browser;
- MorokPay may suggest a matching unpaid sale after an observed balance
  increase, but the seller explicitly confirms it;
- the dashboard is not portable to another browser or device yet;
- the deployed `MorokInvoices` event is not trusted as settlement proof;
- an empty-note helper cannot prove the hidden recipient, token, or amount of a
  separate transfer action. See [private-invoices.md](private-invoices.md).

## App map

- `/` — buyer or seller entry.
- `/pay` — scan or paste a request and make a private payment.
- `/sell` — fixed-price Sale QR and local merchant dashboard.
- `/treasury` — Base CCTP top-up, shield, private balances, and payout.
- `/claim` — experimental legacy claim-link flow.

Previously shared Invoice, Donation, and Private Drop links remain parseable or
are migrated for backwards compatibility, but the current seller interface
does not create them.

Default network is controlled by `NEXT_PUBLIC_STARKNET_NETWORK`; the header can
switch between Sepolia and mainnet. Pool fee is read from `get_fee_amount` (last
verified: 2 STRK on Sepolia and 6 STRK on mainnet).

## Demo and submission path

The clearest short demo uses two Ready accounts on Sepolia:

1. Seller creates `Coffee` for a fixed price and shows the QR.
2. Buyer opens the QR and pays privately.
3. Seller refreshes the private balance and confirms the suggested sale.
4. Seller marks the coffee fulfilled.
5. Reload `/sell` and show the persisted totals, product count, and timestamp.

Before describing this as mainnet-ready, repeat a minimal 0.5–1 USDC payment on
mainnet and retain the before/after balances and transaction hash. Do not list
the `MorokInvoices` address as proof of payment integration.

The earlier first-ten Donation campaign remains a possible attention mechanic:
10/3/3/2/2/2/2/2/2/2 USDC totals exactly 30 USDC. It is currently deferred
because the Sale-only seller surface no longer creates an open-amount Donation
QR. See [contest-first-10.md](contest-first-10.md).

## Future unique invoices

A real Invoice should add something Sale does not:

- a unique, immutable invoice identifier and exact amount;
- contract-backed replay protection;
- settlement state recoverable on another device;
- a receipt cryptographically bound to actual funds for the intended merchant.

The candidate open-note design and its unresolved Ready dependency are captured
in [private-invoices.md](private-invoices.md). Until that path is proven on
Sepolia, a separate Invoice button would only duplicate Sale and should stay
out of the UI.

## Identity

The earlier Aptos MorokPay repo at `C:\work\confident` has no reusable logo
asset, but its `// morokpay` treatment supplied the direction. The app uses a
geometric mint M whose diagonal cut echoes private-payment rails:
`components/brand/morok-mark.tsx` in the header, `app/icon.svg` for Next.js
file-based favicon metadata, and `public/morok-mark.svg` as the portable asset.

## Safety

- Never commit `.secrets/` or funded keys.
- Sepolia transactions are not hackathon mainnet evidence.
- Do not describe a QR, local status, balance delta, or `InvoiceSettled` event
  as cryptographic proof of payment.
- Do not promise sender anonymity: the Ready account calling the pool is public.
- Replace the public unauthenticated RPC with a reliable keyed endpoint before
  campaign traffic.
