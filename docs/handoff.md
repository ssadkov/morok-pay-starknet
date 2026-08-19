# Handoff

Working state of MorokPay for a fresh session. Read this first, then [private-invoices.md](private-invoices.md) if you are touching the contract work.

## What this is

Private USDC payments on Starknet, built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon). Submissions close **31 Aug 2026, 23:59 UTC**; whatever the public repo shows at that moment is the entry. Judging: STRK20 integration depth 30%, working mainnet product 30%, innovation 25%, docs and open-source quality 15%. To place at all, the app must run on **mainnet** against the live pool with at least three mainnet transactions, a demo anyone can open, and `strk20.json` filled in (transactions, contracts, demo URL, video).

Repo `ssadkov/morok-pay-starknet`, MIT, demo at https://morok-pay-starknet.vercel.app.

## Locked architecture

**Ready Wallet API only.** The official pool accepts deposits only with proof facts from the hosted proving service, and that service is IP-whitelisted to Ready and Xverse. Direct Privacy SDK `apply_actions` reverts `EMPTY_PROOF_FACTS`, and Braavos cannot shield. Do not try to derive accounts or hold viewing keys in the app.

The dapp surface is three wallet methods: `wallet_strk20InvokeTransaction`, `wallet_strk20Balances`, `wallet_strk20Mode`. **There is no history API**, so the app cannot list private transfers; it infers them from private balance deltas it observes while open.

## Product surface

- `/` — two doors: pay or get paid.
- `/pay` — opens a QR/link and sends `{ type: "transfer" }` inside the pool.
- `/sell` — merchant invoice (amount, label, invoice number) rendered as QR + link; invoices in `localStorage`.
- `/treasury` — top up from Base over CCTP, shield, cash out.

Every page carries a sidebar with two balances: **Wallet** (public Ready) and **Payment wallet** (private STRK20), plus a local activity feed that badges Morok operations.

Default network is Sepolia (`NEXT_PUBLIC_STARKNET_NETWORK`, storage key `morokpay.network.v2`), switchable in the header. The pool fee comes from `get_fee_amount` on the pool: 2 STRK on Sepolia, 6 STRK on mainnet. **Sepolia transactions are not sprint evidence** — the sprint counts mainnet only.

## Where the code is

Everything below is merged or open on `feat/onchain-invoice-commitment`:

- `components/pay/balance-sidebar.tsx` in a two-column shell, with a local activity feed.
- `lib/pay/activity.ts` — activity store, private-balance reconciliation, invoice matching. Deltas under 0.10 USDC are dropped as scan jitter.
- `treasury-context` polls public balances every 20s and asks for private ones only on connect or after an operation, so Ready stops prompting to share balances.
- `lib/pay/commitment.ts`, `lib/starknet/invoice-events.ts` — Poseidon commitments and the `InvoiceSettled` watcher used by both the till and the payer.
- `lib/starknet/pool-fee.ts` — reads `get_fee_amount` instead of assuming 2 STRK.

`npx tsc --noEmit` and `npm test` pass.

## Decisions made

**Invoice matching moves on-chain via a `privacy_invoke` helper.** Design, privacy analysis, and accepted tradeoffs are in [private-invoices.md](private-invoices.md). Short version: a payment becomes `[transfer, invoke]` in one transaction, and `MorokInvoices` emits `poseidon(TAG, merchant_secret, invoice_seq)` so a merchant reconciles from any device. The static-QR linkability tradeoff is knowingly accepted for now.

**Probe result: the buyer signs.** 40 000 mainnet blocks of pool events gave 19 transactions with 18 distinct senders — no relayer. The buyer's address is public on every private payment; the amount, the merchant, and the invoice are not.

## Test accounts

`node scripts/gen-accounts.mjs` wrote three throwaway OZ accounts to `.secrets/sepolia-accounts.json` (gitignored): `deployer`, `payout`, `spare`. Fund from a Sepolia faucet, then `node scripts/deploy-account.mjs deployer`. Pass `mainnet` as the last argument to both for the real network — those keys hold real STRK, so treat the file as a wallet.

These are plain accounts. They can declare, deploy, and receive public tokens. **They cannot shield or pay privately** — that needs Ready. Testing a real purchase end to end means two Ready profiles, one as buyer and one as merchant.

## Next steps

The Sepolia loop is done: `EchoHelper` and `MorokInvoices` are deployed, a real payment settled its commitment on-chain (`0x58bfa6aa…`), and both the till and the payer flip from the `InvoiceSettled` event. What is left is mainnet.

1. ~~Deploy `MorokInvoices` on mainnet.~~ Live at `0x051587ed…`, pinned to the mainnet pool, declared in `0x3b49401d…`. The deploy cost 2.1 STRK all in.
2. Run at least three mainnet payments against the live pool. Each costs 6 STRK of pool fee in shielded STRK, plus gas.
3. Set `NEXT_PUBLIC_STARKNET_NETWORK=mainnet` on Vercel and swap the public Lava RPC for a keyed endpoint — both the till and the payer poll `getEvents`.
4. Fill `strk20.json` (transactions, contracts, demo URL, video) and the README table.

## Do not

- Commit unless asked.
- Take viewing keys out of Ready, or call the Privacy SDK proving service directly.
- Treat Sepolia transactions as sprint evidence.
- Commit `.secrets/` or any funded key.
