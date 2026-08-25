# MorokPay

Private USDC donations on Starknet, built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon).

A creator publishes one reusable QR. A supporter chooses the amount and confirms the transfer in Ready. The payment stays inside the STRK20 pool, so its amount and sender-to-recipient relationship are not published on-chain.

[Open the live demo](https://morok-pay-starknet.vercel.app)

## How it works

1. Connect Ready on Starknet Mainnet or Sepolia.
2. Activate STRK20 by shielding once.
3. Create one open-amount donation QR, or open a creator's link.
4. Confirm the private USDC transfer in Ready.

Ready holds the viewing key, discovers notes, creates proofs, and submits private transactions. MorokPay never asks for a viewing key and does not call the proving service directly.

## Privacy boundary

STRK20 hides the transfer amount and sender-to-recipient relationship on-chain. It does not make the surrounding activity anonymous:

- a published QR contains the creator's Ready address and label;
- deposits, withdrawals, timing, and open-note amounts can remain public;
- Ready exposes private balances, but not private transfer history, to the dapp;
- MorokPay activity and received status are local to the current browser.

## Current status

- Donation QR, private pay, balance refresh, top-up, and onboarding are implemented.
- `strk20.json` contains three succeeded mainnet pool transactions required for the sprint submission.
- The First 10 activation campaign is planned; see [docs/private-first-10.md](docs/private-first-10.md).
- MorokPay's fee is planned for the in-app unshield step, not for each private donation; see [docs/fees.md](docs/fees.md).
- The isolated MetaMask + Privacy SDK lab has confirmed deterministic Starknet
  account control, a public STRK transfer, and STRK20 registration on Sepolia;
  shield/private transfer/unshield remain to be tested. See
  [docs/metamask-privacy-sdk-sepolia.md](docs/metamask-privacy-sdk-sepolia.md).
- DonationPot is a design-only follow-up; see [docs/donation-pot.md](docs/donation-pot.md).
- The required three-minute submission video is still missing.

Legacy claim links remain redeemable at `/claim` on networks where `MorokEscrow` is deployed. New claim-link creation is no longer part of the donation UI.

## Run locally

Requirements: Node.js 22+ and the [Ready X extension](https://chromewebstore.google.com/detail/ready-x/dlcobpjiigpikoobohmabehhmhfoodbb).

```bash
npm install
npm run dev
```

The app has working RPC defaults. Copy `.env.example` to `.env.local` only when you need to override the network or RPC endpoints.

```bash
npm test
npm run lint
npm run build
```

Open [http://localhost:3000](http://localhost:3000).

## Project notes

- [Current engineering handoff](docs/handoff.md)
- [Fee policy and constraints](docs/fees.md)
- [MetaMask + Privacy SDK Sepolia test](docs/metamask-privacy-sdk-sepolia.md)
- [Why invoice events are not payment proof](docs/private-invoices.md)
- [Legacy claim-link boundary](docs/claim-links.md)

## License

MIT
