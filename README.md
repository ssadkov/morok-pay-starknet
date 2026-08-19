# MorokPay

Private USDC payments on Starknet for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon).

**Pay privately** from a shielded Ready balance, or **get paid** with a QR for an invoice, a sale, a creator donation, or a Private Drop reward. Top up from Base through CCTP when the private wallet is empty.

## Product

1. Connect Ready (Wallet API v6). Ready holds the STRK20 viewing key and talks to the official proving service.
2. **Get paid** — create a fixed-price invoice/sale, a reusable open-amount creator donation QR, or a Private Drop entry.
3. **Pay privately** — buyer opens the link, confirms in Ready. `wallet_strk20InvokeTransaction` `{ type: "transfer" }` stays inside the pool.
4. **Top up** — burn USDC on Base, mint on Starknet, shield. Cash out to Base remains on the same screen.

The reference lives in the payment request; it is not written into the private transfer. Ready does not expose private history to dapps (`wallet_strk20Balances` only), so the sidebar lists activity this browser recorded. The merchant refreshes their private balance and marks a request paid. Why the deployed invoice event is not trusted as payment proof is documented in [docs/private-invoices.md](docs/private-invoices.md).

Pitch later, not in this cut: a company treasury that lands payroll funds, and a private card (issuer rails; a USDC card on Aptos already exists).

## Why Ready

The official STRK20 pool only accepts deposits with proof facts from the hosted proving service. That service is IP-whitelisted to Ready and Xverse. Direct Privacy SDK `apply_actions` calls revert `EMPTY_PROOF_FACTS`.

## Plan

1. **Now — private pay on Sepolia first.** The app defaults to Starknet Sepolia (2 STRK pool fee). Create a QR, pay from a second Ready, then switch the header to Mainnet for sprint evidence. Fast fund: Circle faucet → Starknet Sepolia USDC → shield. Base Sepolia CCTP still works on Top up.
2. **Private Drop.** Entrants create a payable QR only after their STRK20 public key is registered. The first ten valid entries receive privately assigned rewards from a fixed 30 USDC pool. Campaign mechanics: [docs/handoff.md](docs/handoff.md#private-drop-mechanics).
3. **CCTP anonymizer.** Helper the pool calls via `privacy_invoke` so outbound burns do not unshield onto Ready. Proofs still go through Ready.
4. **Solana out.** Same CCTP V2 pattern as Base (domain 5). Aptos is not a native V2 route.
5. **Later.** Payroll treasury, private card, `OutboundAnonymizer` from [privacy-bridge](https://github.com/starkware-libs/privacy-bridge).

## Addresses (Starknet mainnet)

| What | Address |
| --- | --- |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| MorokInvoices (legacy, not payment proof) | `0x051587ed22ddfc47496cdc9486697d927a3f29b5edec6903efc21d94aeb441b8` |
| Starknet USDC | `0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb` |
| MessageTransmitterV2 | `0x02EBB5777B6dD8B26ea11D68Fdf1D2c85cD2099335328Be845a28c77A8AEf183` |
| TokenMessengerMinterV2 | `0x07d421B9cA8aA32DF259965cDA8ACb93F7599F69209A41872AE84638B2A20F2a` |
| Base USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base TokenMessengerV2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` |
| Base MessageTransmitterV2 | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` |

Default RPC is `https://rpc.starknet.lava.build`. Override with `NEXT_PUBLIC_STARKNET_RPC_URL`. The in-app **Mainnet / Sepolia** switcher overrides `NEXT_PUBLIC_STARKNET_NETWORK` at runtime.

The pool fee is read from `get_fee_amount` on the pool itself: 2 STRK on Sepolia, 6 STRK on mainnet. It is paid in shielded STRK, not from the public wallet.

## Scripts

```bash
npm install
cp .env.example .env.local
npm run dev
npm test
```

Research and setup helpers live in `scripts/`: `probe-pool-sender.mjs` and `probe-pool-address.mjs` inspect how real pool transactions are shaped, `gen-accounts.mjs` and `deploy-account.mjs` create accounts for contract work. Current working state for a fresh session: [docs/handoff.md](docs/handoff.md).

Legacy `MorokInvoices` deployment tooling remains for reproducibility, but the current app does not invoke it or trust its event as payment proof:

```bash
node scripts/gen-accounts.mjs mainnet      # keys land in .secrets, gitignored
node scripts/deploy-account.mjs deployer mainnet
cd contracts && scarb build && cd ..
node scripts/deploy-contract.mjs invoices mainnet
```

Mainnet payments use the normal STRK20 transfer. The till reconciles with a private-balance refresh and `Mark paid`; the event helper cannot bind an event to the transfer's hidden recipient and amount.

For a recipient who has not joined the pool yet:

```bash
node scripts/deploy-contract.mjs escrow sepolia
node scripts/deploy-contract.mjs escrow mainnet
```

Park USDC from Get paid → Claim link, then share the `/claim` QR. The amount sits in `MorokEscrow` as plain USDC until they register and claim.

Open [http://localhost:3000](http://localhost:3000). Install [Ready X](https://chromewebstore.google.com/detail/ready-x/dlcobpjiigpikoobohmabehhmhfoodbb) before connecting.

Sprint evidence (`strk20.json` transactions, demo URL, 3-minute video) is filled after the first mainnet txs that touch the official pool.

Live demo: [https://morok-pay-starknet.vercel.app](https://morok-pay-starknet.vercel.app).

## License

MIT
