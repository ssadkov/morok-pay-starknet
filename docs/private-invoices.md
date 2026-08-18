# On-chain invoice matching

Status: design accepted, not implemented. Two probes must pass before any Cairo is written.

## Problem

A merchant cannot tell which sale a private payment settles.

STRK20 notes encrypt a fixed set of fields — amount, token, sender address, recipient address, channel key, index. There is no free-form field, and the Wallet API `transfer` action accepts only `token`, `amount`, `recipient`. So the invoice number cannot ride along with the payment.

Today the invoice number lives on the payment link, and the merchant matches a sale by watching the private balance move in an open browser tab. That fails as soon as the merchant reconciles from another device, since Ready exposes no private history to dapps.

## Mechanism

The Wallet API has a fourth action next to deposit / withdraw / transfer:

```
{ type: "invoke", contract, calldata }
```

The pool calls the named contract through `INVOKE_SELECTOR` inside the same STRK20 transaction, and the contract returns `Span<OpenNoteDeposit>`. This is the anonymizer path used by the Ekubo, Vesu, and CCTP bridge helpers.

`MorokInvoices` uses it without moving any tokens: it emits one event and returns an empty span. The escrow example in the STRK20 docs establishes that an empty span is a valid return ("credit nothing"), so a helper is not required to touch funds.

A payment becomes two actions in one transaction:

```
[ { type: "transfer", token, amount, recipient: merchant },
  { type: "invoke",   contract: MOROK_INVOICES, calldata: [commitment] } ]
```

## Commitment

The event carries a single opaque felt:

```
commitment = poseidon([TAG, merchant_secret, invoice_seq])
```

- `merchant_secret` is derived from a Ready signature over a fixed message, so the merchant can recompute it on any device without syncing storage.
- `invoice_seq` is a per-merchant counter, so the merchant enumerates `1..N` when reconciling and looks each commitment up by event key over plain RPC — no indexer.
- Nothing else goes in. Amount and label stay off-chain; a fresh device learns *which invoices are settled*, not what they were for.

Forgery needs `merchant_secret`, and `privacy_invoke` asserts the caller is the pool, so nobody can emit events by calling the contract directly. A repeated commitment is treated as the first occurrence.

## What this leaks

The buyer's account signs the pool transaction, so their address is already public on every private payment. The contract call adds one bit on top: that address paid *through MorokPay* at that time, which makes MorokPay users a publicly enumerable subset of the pool's anonymity set. The merchant address, the amount, and the invoice number stay hidden. The merchant signs nothing and never appears on chain.

Anyone holding the payment link can recompute the commitment and confirm that a specific buyer settled a specific invoice. With a per-sale link that secret is shared by two parties, which is acceptable.

**Accepted tradeoff:** a static QR reuses one `invoice_seq` across many buyers, so all of its payments carry an identical commitment and form a publicly linkable cluster; photographing the QR de-anonymizes that cluster. This is accepted for now. The fix, if it becomes worth building, is an announcement scheme — the buyer encrypts the invoice number to the merchant's public key, producing a distinct ciphertext per payment that only the merchant can scan for.

## Probes

1. **Who signs — answered, the buyer does.** `scripts/probe-pool-sender.mjs` scanned 40 000 mainnet blocks of pool events: 19 pool transactions, 18 distinct `sender_address` values. Nobody relays, so the buyer's account is public on every private payment and the leak above stands as written.

   The same scan showed accounts calling `0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f` rather than the pool directly; the pool at `0x0403…812a` then emits its own events inside that transaction (`scripts/probe-pool-address.mjs`). Since the pool is what performs `privacy_invoke`, the pool address is what `MorokInvoices` must accept as caller — but confirm that in probe 2 before hardcoding it.

2. **Bare invoke — open.** Deploy the docs' `EchoHelper` on Sepolia and send `[transfer, invoke]` from Ready. Confirms two unknowns at once: that the pool accepts an invoke with no withdraw leg, and that Ready does not block an unfamiliar contract. Log the caller the helper sees.

If probe 2 fails, the fallback is a unique per-invoice amount nonce (for example `12.500137`), which makes the existing balance-delta match exact and writes nothing on chain — at the cost of cross-device reconciliation.

## Build order

1. Probe 2 above.
2. Scarb package under `contracts/` with `MorokInvoices` and `snforge` tests.
3. TypeScript: commitment helper, merchant key derivation, invoice counter.
4. Pay flow appends the invoke action; sell flow reconciles by reading events over `getEvents`.
5. Deploy to Sepolia, then mainnet; record addresses in `strk20.json` and the README.
