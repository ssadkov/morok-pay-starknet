# MorokPay

Private USDC donations on Starknet, built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon).

A creator publishes one reusable QR. A supporter chooses the amount and confirms the transfer in Ready, or in MetaMask with no Starknet wallet at all. The payment stays inside the STRK20 pool, so its amount and sender-to-recipient relationship are not published on-chain.

[Open the live demo](https://morok-pay-starknet.vercel.app) · [Announcement thread](https://x.com/ssadkov/status/2093793308359409909)

## How it works

1. Connect Ready X on Starknet Mainnet or Sepolia, or connect MetaMask and let the app derive and deploy a Starknet account for you.
2. Activate STRK20 by shielding once.
3. Create one open-amount donation QR, or open a creator's link.
4. Confirm the private USDC transfer in the connected wallet.

Ready holds the viewing key and implements the STRK20 Wallet API. On the EVM path, MetaMask retains the Ethereum signing key while MorokPay derives the viewing key in browser memory from a repeatable EIP-712 signature and uses the Privacy SDK directly. MorokPay never asks for either secret, and never sees a viewing key server-side.

## Privacy boundary

STRK20 hides the transfer amount and sender-to-recipient relationship on-chain. It does not make the surrounding activity anonymous:

- a published QR contains the creator's Ready address and label;
- deposits, withdrawals, timing, and open-note amounts can remain public;
- the first private transfer to a new recipient opens a channel, which
  publishes that recipient's address; the number of distinct senders who ever
  opened one is a public view;
- the proving service receives the sender's address, viewing key, and actions
  in the clear - OHTTP hides the client's IP, not the content - and the pool's
  auditor can decrypt a withdrawal's address and an open note's owner;
- Ready exposes private balances, but not private transfer history, to the dapp;
- MorokPay activity and received status are local to the current browser.

What follows from this, and what closes each gap, is specified in
[docs/private-donation-requirements.md](docs/private-donation-requirements.md).

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

## The whole round trip, on mainnet, with real money

A MetaMask user with no Starknet wallet went from nothing to USDC on an
exchange without leaving the app. Every step is a real mainnet transaction,
and every cost below was read off its receipt:

| step | pool fee | gas | total STRK | transaction |
| --- | ---: | ---: | ---: | --- |
| Deploy the derived Starknet account | - | - | - | `0x6ab36fb2b6…3894` |
| Enable Private (register in the pool) | 6 | 2.68-4.42 | 8.68-10.42 | `0x21b12f4dbe…f22d0` |
| Shield 1 USDC | 6 | 5.31 | 11.31 | `0x506c1e0665…da2a` |
| Unshield 1 USDC | 6 | 4.41 | 10.41 | `0x114fb5ad4a…9929` |
| Send it to a Binance deposit address | - | 1.33 | 1.33 | `0x2401314ccd…1daa` |

Two things worth naming. **The pool fee is paid from public STRK in both
directions on this rail** - no STRK ever has to be shielded to cover it, which
is the opposite of Ready X, where Enable Private bundles a shield and a
paymaster fronts the fee. And **nothing here is sponsored**: every transaction
above was submitted by the derived account itself and paid for out of its own
balance. On the Ready X rail the same operations arrive from a paymaster and
cost the user only the 6 STRK fee.

## What runs where

| | Starknet Mainnet | Sepolia |
| --- | --- | --- |
| Donation QR, private pay, activity | Ready X · MetaMask | Ready X · MetaMask |
| Private balances | Ready X · MetaMask | Ready X · MetaMask |
| Shield / unshield in the app | Ready X · MetaMask | Ready X · MetaMask |
| Send a public balance out to an exchange | Ready X · MetaMask | Ready X · MetaMask |
| Relayed first donation, so the donor is never named | both rails | both rails |
| Anonymous receive account behind a QR | MetaMask | MetaMask |
| Base → Starknet top-up over CCTP | - | Ready X |

`/privacy-sdk-lab` still runs every step one at a time with the proof, the fee
and the resource bounds shown explicitly. It is a diagnostic surface now, not
the way in; the balances sidebar links to it quietly.

Mainnet differs from Sepolia by design: Sepolia sponsors a new account with 20
test STRK, mainnet never sends STRK to a connecting address and requires it to
be funded first.

`strk20.json` lists the succeeded mainnet transactions against the live STRK20
pool. This project answers [RFP-12 — private subscriptions and creator
monetization](https://strk20.starknet.io/rfp/private-subscriptions).

## Two privacy gaps this closes, and how each was verified

STRK20 hides the amount. It does not, on its own, hide either party:

- **The donor.** The first private transfer to a creator opens a channel, and
  submitted by the donor it puts their address in the transaction envelope.
  `/api/privacy/relay` submits that one transfer from MorokPay's own relayer
  instead, so the donor appears in neither the envelope nor the calldata.
  Verified on mainnet: `0x72a1ff15…` names only the recipient.
- **The creator.** A donation QR necessarily publishes the address that
  receives. On the MetaMask rail that address is a separate receive account
  derived for the purpose, deployed and registered by the relayer so the
  creator's main account never pays for it and is never linked to it.

Which addresses a private transfer actually publishes was measured rather than
assumed - [scripts/calldata-leak-probe.mjs](scripts/calldata-leak-probe.mjs)
asks the pool `get_public_key` about every felt in a transaction's calldata,
so a registered account sitting there in the clear is visible.

## Current status

- Both rails are live on mainnet, in the app: donation QR, private pay, private
  balances, shield, unshield, and sending a public balance out.
- The MetaMask path needs no Starknet wallet at all. `StarknetEth712Account`
  and `AccountFactory` are declared and deployed on mainnet, the mainnet
  proving and discovery services answer without a credential, and the whole
  round trip above was done from the browser with MetaMask signing every step.
  See [docs/metamask-privacy-sdk-sepolia.md](docs/metamask-privacy-sdk-sepolia.md)
  and [docs/evm-account-portability.md](docs/evm-account-portability.md).
- The anonymous receive account is live on the MetaMask rail. On Ready X the
  signature it depends on is checked and reproducible, but the deploy path is
  not wired yet, so a Ready X QR still publishes that wallet's own address.
- A live donation contest is documented in
  [docs/private-contest.md](docs/private-contest.md).
- MorokPay's fee is planned for the in-app unshield step, not for each private donation; see [docs/fees.md](docs/fees.md).
- `lib/starknet/tokens.ts` already carries mainnet `strkBTC` alongside USDC, and
  amount parsing is decimals-aware. The donation request format is USDC-only, so
  private BTC donations remain a follow-up rather than a shipped feature.
- DonationPot is a design-only follow-up; see [docs/donation-pot.md](docs/donation-pot.md).
- Funded onboarding - bridge, auto-swap to STRK, then shield - is researched but
  unbuilt; see [docs/funded-onboarding.md](docs/funded-onboarding.md).

## Roadmap

The nearest piece removes the last thing that still asks a supporter to go buy
an unrelated token: arriving with USDC on Base and reaching a private balance
without ever acquiring STRK by hand. CCTP is already wired, and the shape is
settled by a constraint rather than a preference - a shield cannot be relayed,
because STRK20 passes its proof as a transaction-level extension and SNIP-9
outside execution has no field for one. So the flow splits at that boundary:
the relayer bridges, swaps a slice to STRK through AVNU and pays for all of it,
and the user's own account then pays for the shield with STRK it never had to
buy.

That, and what else is open - the anonymous receive account on Ready X, batched
payouts, where MorokPay's own fee belongs - is in
[docs/roadmap.md](docs/roadmap.md).

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
