# MorokPay

Private **USDC donations** on Starknet for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon).

A creator publishes one QR. Supporters pay from a shielded Ready balance. The transfer stays inside the STRK20 pool: amount and counterparty are hidden. Sale/invoice checkout is not the sprint focus.

Live demo: [https://morok-pay-starknet.vercel.app](https://morok-pay-starknet.vercel.app).

## Sprint plan

1. **Donation UI** — one durable open-amount QR for the creator, a clean pay screen for the supporter, a simple till for the creator (balance in, mark received). Work is next; this commit is the product decision on `master`.
2. **First 10 contest** — ten people activate STRK20, publish a Donation QR, and all receive private USDC from a 30 USDC pool. Rules: [docs/private-first-10.md](docs/private-first-10.md).
3. **DonationPot, if time** — anonymous on-chain jar with a public running total. The creator can sweep the jar into a shielded note so observers see the jar empty, not which wallet was paid. Design only: [docs/donation-pot.md](docs/donation-pot.md). Do not start Cairo until 1 and 2 are done.

Private donations use a normal `wallet_strk20InvokeTransaction` `{ type: "transfer" }`. No helper is required on that path. [Why the invoice event is not payment proof](docs/private-invoices.md).

## Mainnet evidence

Ready account (Deposit events name this address; the Starknet tx sender is the relayer):

[`0x00e5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423`](https://voyager.online/contract/0x00e5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423)

Three succeeded mainnet transactions against the live STRK20 pool, listed in `strk20.json`:

| Tx | Voyager |
| --- | --- |
| `0x713ffeebec069111eead005c294c8c409b3569c0f4e39231f5e3d549d9050e1` | [view](https://voyager.online/tx/0x713ffeebec069111eead005c294c8c409b3569c0f4e39231f5e3d549d9050e1) |
| `0x5622d6617aee8a26195f26657cc4bca9e3c64ef5f5564f78ff2632d7d2927df` | [view](https://voyager.online/tx/0x5622d6617aee8a26195f26657cc4bca9e3c64ef5f5564f78ff2632d7d2927df) |
| `0x29328374e483246e685d649222316a24cc6c3998702f0c561fc00578ff59bfb` | [view](https://voyager.online/tx/0x29328374e483246e685d649222316a24cc6c3998702f0c561fc00578ff59bfb) |

Demo URL is live. The 3-minute video is still missing.

## Product

1. Connect Ready (Wallet API v6). Ready holds the viewing key and talks to the official proving service.
2. **Get paid** — create a reusable Donation QR (amount empty). Invoice/sale/Drop controls remain in the current UI and will be narrowed in the donation-UI pass.
3. **Pay privately** — open the link, confirm in Ready. The transfer stays in the pool.
4. **Top up** — burn USDC on Base, mint on Starknet, shield.

Ready does not expose private history to dapps (`wallet_strk20Balances` only). Activity in the sidebar is what this browser recorded. The creator refreshes the private balance and confirms the donation.

## Why Ready

The official STRK20 pool only accepts deposits with proof facts from the hosted proving service. That service is IP-whitelisted to Ready and Xverse. Direct Privacy SDK `apply_actions` calls revert `EMPTY_PROOF_FACTS`.

## Addresses (Starknet mainnet)

| What | Address |
| --- | --- |
| Ready (sprint wallet) | [`0x00e5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423`](https://voyager.online/contract/0x00e5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423) |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Starknet USDC | `0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb` |
| MessageTransmitterV2 | `0x02EBB5777B6dD8B26ea11D68Fdf1D2c85cD2099335328Be845a28c77A8AEf183` |
| TokenMessengerMinterV2 | `0x07d421B9cA8aA32DF259965cDA8ACb93F7599F69209A41872AE84638B2A20F2a` |
| Base USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base TokenMessengerV2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` |
| Base MessageTransmitterV2 | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` |

`MorokInvoices` (`0x051587ed22ddfc47496cdc9486697d927a3f29b5edec6903efc21d94aeb441b8`) is a legacy helper. Do not list it as payment proof.

Default RPC is `https://rpc.starknet.lava.build`. Override with `NEXT_PUBLIC_STARKNET_RPC_URL`. The in-app **Mainnet / Sepolia** switcher overrides `NEXT_PUBLIC_STARKNET_NETWORK` at runtime.

The pool fee is read from `get_fee_amount` on the pool itself: 2 STRK on Sepolia, 6 STRK on mainnet. It is paid in shielded STRK, not from the public wallet.

## Scripts

```bash
npm install
cp .env.example .env.local
npm run dev
npm test
```

Working state for a fresh session: [docs/handoff.md](docs/handoff.md).

```bash
node scripts/draw-private-drop.mjs entries.txt 0xFINALIZED_BLOCK_HASH
```

Open [http://localhost:3000](http://localhost:3000). Install [Ready X](https://chromewebstore.google.com/detail/ready-x/dlcobpjiigpikoobohmabehhmhfoodbb) before connecting.

## License

MIT
