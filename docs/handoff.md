# Handoff

MorokPay is a private-payments product on Starknet built for the STRK20 Private
Sprint. The strongest demo is no longer a generic wallet: it is a merchant and
creator payment surface with a public participation loop called **Private
Drop**.

## Product thesis

One QR interaction covers four real use cases:

1. a merchant invoice;
2. an in-person fixed-price sale;
3. a reusable creator donation QR with an optional supporter-chosen amount;
4. a Private Drop entry that can receive a private reward.

The creator can put the donation QR in a video. A contest participant connects
Ready, activates STRK20 once, generates a Private Drop QR, and publishes it.
MorokPay checks the pool's public-key registry before enabling that entry, so it
is a payable STRK20 account rather than an arbitrary pasted Starknet address.

This proves wallet activation, not unique humanity. Social eligibility and one
entry per account remain contest rules, not a Sybil guarantee.

## Locked technical boundary

Ready holds the viewing key. MorokPay uses Wallet API methods for private
balances and `wallet_strk20InvokeTransaction` for a normal private transfer.
It does not extract keys or call the hosted prover directly.

Ready exposes balances, not private transfer history. Therefore:

- labels and references remain in the QR and local browser storage;
- the merchant refreshes private balance and explicitly marks a request paid;
- the deployed `MorokInvoices` event is not trusted as settlement proof;
- an empty-note helper cannot prove the hidden recipient, token, or amount of a
  separate transfer action. See [private-invoices.md](private-invoices.md).

## Private Drop mechanics

Recommended first campaign:

1. Publish the campaign post and a short demo video.
2. Entrants open Get paid → Private Drop on Starknet mainnet.
3. They connect Ready and shield once if their STRK20 public key is not yet
   registered.
4. They generate an open-reward QR and reply with the link or QR image.
5. Freeze the first ten eligible entries and publish the list before the
   announced randomness block.
6. Use a future finalized Starknet block hash as the randomness seed. Everyone
   receives a reward: one entry gets 10 USDC, two get 3 USDC, and seven get 2
   USDC, for an exact 30 USDC budget.
7. Open all ten requests in MorokPay and pay them privately from a funded Ready
   account.
8. Publish only pool transaction hashes as execution evidence. Do not claim
   those hashes publicly identify the winner or amount.

Freeze one absolute `/pay?...&kind=drop` URL per line in `entries.txt`, publish
the file hash before the announced block, then run:

```bash
node scripts/draw-private-drop.mjs entries.txt 0xFINALIZED_BLOCK_HASH
```

The script rejects duplicates, non-mainnet links, fixed self-selected reward
amounts, and non-Drop links. It prints the canonical eligible-list hash, scoring
algorithm, seed, and allocations. Pool registration still needs to be checked when
freezing the eligible list; QR generation and the payment screen perform that
check against `get_public_key`.

All first ten valid participants are rewarded, so the campaign is not a lucky
draw. The block hash only assigns the 10/3/3/2 USDC reward tiers. Allocation is
auditable while payout recipient and amount remain private on-chain. The public
QR itself necessarily reveals the entry address to people who see it.

## App map

- `/` — pay or get paid.
- `/pay` — scan/paste request, optionally choose donation amount, private pay.
- `/sell` — invoice, sale, donation, and Private Drop QR creation.
- `/treasury` — Base CCTP top-up, shield, private balances, payout.
- invoices and MorokPay activity are stored locally.

Default network is controlled by `NEXT_PUBLIC_STARKNET_NETWORK`; the header can
switch between Sepolia and mainnet. Pool fee is read from `get_fee_amount` (last
verified: 2 STRK on Sepolia and 6 STRK on mainnet).

## Submission state and next gates

- Unit tests, TypeScript, lint, and production build must all be green.
- `strk20.json` already has three candidate mainnet pool transaction hashes, but
  they must be the intended end-to-end product actions before submission.
- Do not list the `MorokInvoices` address as proof of payment integration.
- Record a mainnet demo: activate participant, generate Private Drop QR, fund
  payer, scan and pay, refresh recipient balance.
- Add final demo and video URLs to `strk20.json` only when public and verified.
- Replace the public unauthenticated RPC with a reliable keyed endpoint before
  campaign traffic.

## Identity

The earlier Aptos MorokPay repo at `C:\work\confident` has no reusable logo
asset. Its recognizable identity is the restrained near-black wallet surface
and plain MorokPay wordmark. Reuse that product lineage, but create a small
portable mark designed for QR/video use rather than pretending an old logo file
exists. Do not overwrite `brand.md` or the current theme until a palette and mark
direction are explicitly selected.

## Safety

- Never commit `.secrets/` or funded keys.
- Sepolia transactions are not hackathon mainnet evidence.
- Do not describe a payment request, local status, or `InvoiceSettled` event as
  cryptographic proof of payment.
- Do not promise sender anonymity: the Ready account calling the pool is public.
