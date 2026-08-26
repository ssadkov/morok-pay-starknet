# MorokPay

Private USDC donations on Starknet, built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon).

A creator publishes one reusable QR. A supporter chooses the amount and confirms the transfer in Ready or the Sepolia EVM beta. The payment stays inside the STRK20 pool, so its amount and sender-to-recipient relationship are not published on-chain.

[Open the live demo](https://morok-pay-starknet.vercel.app)

## How it works

1. Connect Ready on Starknet Mainnet or Sepolia, or an EVM wallet in the Sepolia beta.
2. Activate STRK20 by shielding once.
3. Create one open-amount donation QR, or open a creator's link.
4. Confirm the private USDC transfer in the connected wallet.

Ready holds the viewing key and implements the STRK20 Wallet API. In the Sepolia EVM beta, MetaMask retains the EVM signing key while MorokPay derives the deterministic viewing key in browser memory and uses the Privacy SDK directly. MorokPay never asks for either secret.

## Privacy boundary

STRK20 hides the transfer amount and sender-to-recipient relationship on-chain. It does not make the surrounding activity anonymous:

- a published QR contains the creator's Ready address and label;
- deposits, withdrawals, timing, and open-note amounts can remain public;
- Ready exposes private balances, but not private transfer history, to the dapp;
- MorokPay activity and received status are local to the current browser.

## What runs where

MorokPay is judged as a mainnet product. The EVM entry path is an explicitly
scoped Sepolia beta and is not presented as mainnet capability.

| | Starknet Mainnet | Sepolia |
| --- | --- | --- |
| Donation QR, private pay, activity | Ready | Ready |
| Private balances and top-up | Ready | Ready |
| In-app USDC unshield | Ready | Ready |
| EVM wallet entry (MetaMask, no Ready) | not deployed | beta |
| Shield / unshield from an EVM-owned account | not deployed | `/privacy-sdk-lab` |

`strk20.json` lists three succeeded mainnet transactions against the live STRK20
pool. This project answers [RFP-12 — private subscriptions and creator
monetization](https://strk20.starknet.io/rfp/private-subscriptions).

## Current status

- Donation QR, private pay, balance refresh, top-up, in-app unshield, and onboarding are implemented on mainnet through Ready.
- Donate and My QR expose `Connect EVM wallet` on Sepolia. Connection checks
  deterministic-account deployment, the approved STRK20 account class, and
  live privacy-pool registration. Incomplete accounts are gated into
  `/privacy-sdk-lab`; ready accounts can discover private balances and send a
  private USDC donation through the Privacy SDK.
- The isolated MetaMask + Privacy SDK lab has confirmed deterministic Starknet
  account control, STRK20 registration, STRK and USDC shield/unshield, and a
  private USDC transfer on Sepolia. A fresh MetaMask account also completed
  faucet funding and server-relayed factory deployment. The home page now links
  to a Sepolia beta that atomically sponsors the generated account to 20 STRK
  and deploys it with a server-only relayer. See
  [docs/metamask-privacy-sdk-sepolia.md](docs/metamask-privacy-sdk-sepolia.md).
  Moving this path to mainnet needs the account class and factory declared on
  mainnet and a mainnet proving service; neither is done.
- The First 10 activation campaign is planned; see [docs/private-first-10.md](docs/private-first-10.md).
- MorokPay's fee is planned for the in-app unshield step, not for each private donation; see [docs/fees.md](docs/fees.md).
- `lib/starknet/tokens.ts` already carries mainnet `strkBTC` alongside USDC, and
  amount parsing is decimals-aware. The donation request format is USDC-only, so
  private BTC donations remain a follow-up rather than a shipped feature.
- DonationPot is a design-only follow-up; see [docs/donation-pot.md](docs/donation-pot.md).

Legacy claim links remain redeemable at `/claim` on networks where `MorokEscrow` is deployed. New claim-link creation is no longer part of the donation UI.

## Run locally

Requirements: Node.js 22+ and the [Ready X extension](https://chromewebstore.google.com/detail/ready-x/dlcobpjiigpikoobohmabehhmhfoodbb).
The `/privacy-sdk-lab` onboarding and the Sepolia Donate/My QR EVM connector
support MetaMask or another compatible injected EVM wallet.

```bash
npm install
npm run dev
```

The app has working RPC defaults. Copy `.env.example` to `.env.local` when you
need to override RPC endpoints or configure the server-only Sepolia deployment
relayer. Never expose its private key through a `NEXT_PUBLIC_` variable.

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
