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

Default network is Sepolia (`NEXT_PUBLIC_STARKNET_NETWORK`, storage key `morokpay.network.v2`), switchable in the header. Pool fee is 2 STRK on Sepolia, ~6 STRK on mainnet. **Sepolia transactions are not sprint evidence** — the sprint counts mainnet only.

## Uncommitted work in the tree

Last commit is `2872782`. Not yet committed:

- `components/pay/balance-sidebar.tsx`, wired into `components/pay/app-shell.tsx` (two-column layout, header widened to `max-w-6xl`).
- `lib/pay/activity.ts` + tests — local activity store, private-balance reconciliation, invoice matching.
- `recordActivity` calls in `pay-panel`, `shield-panel`, `payout-panel`; `account-card` slimmed so balances are not duplicated.
- `treasury-context` keeps a `useRef` of the previous private USDC and reconciles deltas; refreshes every 20s.
- `docs/`, `scripts/`, `.gitignore` entry for `/.secrets`.

`npx tsc --noEmit` and `npm test` pass (35 tests).

## Decisions made

**Invoice matching moves on-chain via a `privacy_invoke` helper.** Design, privacy analysis, and accepted tradeoffs are in [private-invoices.md](private-invoices.md). Short version: a payment becomes `[transfer, invoke]` in one transaction, and `MorokInvoices` emits `poseidon(TAG, merchant_secret, invoice_seq)` so a merchant reconciles from any device. The static-QR linkability tradeoff is knowingly accepted for now.

**Probe result: the buyer signs.** 40 000 mainnet blocks of pool events gave 19 transactions with 18 distinct senders — no relayer. The buyer's address is public on every private payment; the amount, the merchant, and the invoice are not.

## Test accounts

`node scripts/gen-sepolia-accounts.mjs` wrote three throwaway OZ accounts to `.secrets/sepolia-accounts.json` (gitignored): `deployer`, `payout`, `spare`. Fund from a Sepolia faucet, then `node scripts/deploy-account.mjs deployer`.

These are plain accounts. They can declare, deploy, and receive public tokens. **They cannot shield or pay privately** — that needs Ready. Testing a real purchase end to end means two Ready profiles, one as buyer and one as merchant.

## Next steps

1. Probe 2: deploy `EchoHelper` on Sepolia, fire `[transfer, invoke]` from Ready, confirm the pool allows an invoke with no withdraw leg and log the caller the helper sees.
2. `contracts/` Scarb package with `MorokInvoices` + snforge tests.
3. TypeScript: commitment helper, merchant secret from a Ready signature, invoice counter.
4. Wire pay flow to append the invoke; sell flow reconciles over `getEvents`.
5. Mainnet deploy, then fill `strk20.json` and the README.

## Do not

- Commit unless asked.
- Take viewing keys out of Ready, or call the Privacy SDK proving service directly.
- Treat Sepolia transactions as sprint evidence.
- Commit `.secrets/` or any funded key.
