# MorokPay

Private USDC donations on Starknet, built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon).

A creator publishes one reusable QR. A supporter chooses the amount and confirms the transfer in Ready, or in MetaMask with no Starknet wallet at all. The payment stays inside the STRK20 pool, so its amount and sender-to-recipient relationship are not published on-chain.

[Open the live demo](https://morok-pay-starknet.vercel.app)

## How it works

1. Connect Ready on Starknet Mainnet or Sepolia, or onboard an EVM wallet through `/privacy-sdk-lab`.
2. Activate STRK20 by shielding once.
3. Create one open-amount donation QR, or open a creator's link.
4. Confirm the private USDC transfer in the connected wallet.

Ready holds the viewing key and implements the STRK20 Wallet API. On the EVM path, MetaMask retains the Ethereum signing key while MorokPay derives the viewing key in browser memory from a repeatable EIP-712 signature and uses the Privacy SDK directly. MorokPay never asks for either secret, and never sees a viewing key server-side.

## Privacy boundary

STRK20 hides the transfer amount and sender-to-recipient relationship on-chain. It does not make the surrounding activity anonymous:

- a published QR contains the creator's Ready address and label;
- deposits, withdrawals, timing, and open-note amounts can remain public;
- Ready exposes private balances, but not private transfer history, to the dapp;
- MorokPay activity and received status are local to the current browser.

## STRK20 without a Starknet wallet

MorokPay onboards a user who has **only MetaMask** into the mainnet STRK20 pool.
MetaMask keeps an ordinary Ethereum key and signs EIP-712; a deterministic
Starknet account, derived from the EVM address, validates those signatures and
submits its own transactions. No Starknet wallet, no seed phrase, no browser
extension beyond the one they already have.

This is not the Starknet Snap, and it is not a claim that MetaMask implements
any STRK20 wallet method. The account class and factory are deployed on mainnet
and the Privacy SDK does proving and note discovery in the page.

Confirmed on mainnet through the deployed app, MetaMask signing every step:

| | |
| --- | --- |
| EVM owner | `0x5371486EdF41539725aC5E35FfeB24725eD3ABF9` |
| Derived Starknet account | `0x06c90d9b384e76a72435b87634153999b8690b3305e18a43613ab368fea887a9` |
| Deployed through the factory | `0x6ab36fb2b6…3894` |
| Registered in the live pool | `0x21b12f4dbe…f22d0` |

Every hash, cost, and compatibility finding is in
[docs/metamask-privacy-sdk-sepolia.md](docs/metamask-privacy-sdk-sepolia.md).
What another application would need to resolve the same account and read the
same private balance is specified in
[docs/evm-account-portability.md](docs/evm-account-portability.md) - the factory
is permissionless, so no permission from us is required.

## What runs where

| | Starknet Mainnet | Sepolia |
| --- | --- | --- |
| Donation QR, private pay, activity | Ready | Ready |
| Private balances and top-up | Ready | Ready |
| In-app USDC unshield | Ready | Ready |
| EVM wallet entry, `/privacy-sdk-lab` | confirmed in the browser | confirmed in the browser |
| Shield / unshield from an EVM-owned account | `/privacy-sdk-lab` | `/privacy-sdk-lab` |
| `Connect EVM wallet` on Donate and My QR | not yet - see below | beta |

The lab is network-aware on both chains. The shared `Connect EVM wallet` button
on Donate and My QR still routes through `lib/privacy/evm-strk20-account.ts`,
which remains hard-coded to Sepolia - that is the one path not yet repointed,
and it is wiring rather than an unknown.

Mainnet deployment differs from Sepolia by design: Sepolia sponsors a new
account with 20 test STRK, mainnet never sends STRK to a connecting address and
requires it to be funded first.

`strk20.json` lists six succeeded mainnet transactions against the live STRK20
pool. This project answers [RFP-12 — private subscriptions and creator
monetization](https://strk20.starknet.io/rfp/private-subscriptions).

## Current status

- Donation QR, private pay, balance refresh, top-up, in-app unshield, and onboarding are implemented on mainnet through Ready.
- Donate and My QR expose `Connect EVM wallet` on Sepolia. Connection checks
  deterministic-account deployment, the approved STRK20 account class, and
  live privacy-pool registration. Incomplete accounts are gated into
  `/privacy-sdk-lab`; ready accounts can discover private balances and send a
  private USDC donation through the Privacy SDK.
- The MetaMask path is live on mainnet. `StarknetEth712Account` and
  `AccountFactory` are declared and deployed there, the mainnet proving and
  discovery services are reachable without a credential, and a real MetaMask
  account has been deployed and registered in the live pool from the browser.
  The lab also covers STRK and USDC shield/unshield and a private USDC transfer,
  confirmed on Sepolia. See
  [docs/metamask-privacy-sdk-sepolia.md](docs/metamask-privacy-sdk-sepolia.md)
  and [docs/evm-account-portability.md](docs/evm-account-portability.md).
- The First 10 activation campaign is planned; see [docs/private-first-10.md](docs/private-first-10.md).
- MorokPay's fee is planned for the in-app unshield step, not for each private donation; see [docs/fees.md](docs/fees.md).
- `lib/starknet/tokens.ts` already carries mainnet `strkBTC` alongside USDC, and
  amount parsing is decimals-aware. The donation request format is USDC-only, so
  private BTC donations remain a follow-up rather than a shipped feature.
- DonationPot is a design-only follow-up; see [docs/donation-pot.md](docs/donation-pot.md).
- Funded onboarding - bridge, auto-swap to STRK, then shield - is researched but
  unbuilt; see [docs/funded-onboarding.md](docs/funded-onboarding.md).

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
- [MetaMask + Privacy SDK: Sepolia and mainnet](docs/metamask-privacy-sdk-sepolia.md)
- [Portable EVM-owned STRK20 accounts](docs/evm-account-portability.md)
- [Why invoice events are not payment proof](docs/private-invoices.md)
- [Legacy claim-link boundary](docs/claim-links.md)
- [Funded onboarding: bridge, swap, shield](docs/funded-onboarding.md)

## License

MIT
