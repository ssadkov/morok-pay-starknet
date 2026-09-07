# MorokPay

Private USDC on Starknet, for anyone holding an Ethereum wallet. Built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon).

Send private USDC to any EVM address, or publish one reusable donation QR. The recipient collects with MetaMask alone — no Starknet wallet, no STRK, no gas — because MorokPay deploys their Starknet account and pays for the claim in a single transaction. Transfers stay inside the STRK20 pool, so the amount and the sender-to-recipient relationship are not published on-chain.

[Watch the 3-minute demo](https://youtu.be/z_5YCVg9ODU) · [Open the live demo](https://morok-pay-starknet.vercel.app) · [Announcement thread](https://x.com/ssadkov/status/2093793308359409909)

## For the panel

| | |
| --- | --- |
| 3-minute demo video | [youtu.be/z_5YCVg9ODU](https://youtu.be/z_5YCVg9ODU) |
| Live demo | [morok-pay-starknet.vercel.app](https://morok-pay-starknet.vercel.app) |
| Mainnet transactions | five in [`strk20.json`](strk20.json), each through one of our own deployed contracts |
| Real users on mainnet | four strangers finished the [contest](#private-donation-contest) entry unaided; one collected a sponsored claim with an empty MetaMask |
| RFP | [RFP-09](https://strk20.starknet.io/rfp/cross-chain-privacy-hub), answered end to end on mainnet: in from Base, held privately, back out — with no STRK in the user's hands |
| Published for other teams | The `AccountFactory` is **permissionless** — `deploy_account` carries no role check, so any project can derive and deploy the same Starknet account for the same EVM wallet without asking us, and without a key from us. The scheme is specified in [docs/evm-account-portability.md](docs/evm-account-portability.md), down to the address derivation and the exact EIP-712 message |

The five listed transactions are the ones that satisfy the scoring rule in
both directions: each touched the STRK20 pool **and** ran through
`MorokEscrow` or `MorokEscrowV2`. Two are the September 4 park and the
September 5 sponsored claim; three ran through Escrow V2 on the afternoon of
September 7. Dozens of other mainnet transactions appear throughout this README
- registration, shield, unshield, the relayed donation, the contest payouts -
and they are evidence for the reader rather than manifest entries.

## Deployed contracts

All six are live and were read back on chain on 2026-09-07.

| | Starknet Mainnet | Sepolia |
| --- | --- | --- |
| `MorokEscrowV2` — send to an EVM address | [`0x06314101…4253a`](https://voyager.online/contract/0x6314101ff10835af0bfef051ddb9fe456cb9541d073a0ff45326a0c654253a) | [`0x0424e3e9…17654`](https://sepolia.voyager.online/contract/0x424e3e9145946afa96102d188398c13cf71a8d1efb0bfc7f3312777a3b17654) |
| `AccountFactory` — derives and deploys an EVM-owned Starknet account | [`0x07ead3a8…627aa`](https://voyager.online/contract/0x7ead3a89ae0a67ed6ba18caa1b9643437ff9432bab66ab0b2a27e46e0c627aa) | [`0x078ce3c3…de35f`](https://sepolia.voyager.online/contract/0x078ce3c3e3080a579d268feae011761b32146efd40f4faa14dc8b9a30b4de35f) |
| `MorokEscrow` — the earlier claim-link contract, still redeemable | [`0x06199365…b698f`](https://voyager.online/contract/0x06199365a45fa8fe4874bb82727fdf5d849631cde9ca557f497abe7c4ccb698f) | [`0x0407827c…896a5`](https://sepolia.voyager.online/contract/0x0407827c97ea537970b306f6ccbeb08c5f57224732280eb7b7a23184cad896a5) |

The account class the mainnet factory hands out is `0x0697437b…5586e`, and the
factory is **permissionless** — any application can resolve the same account
for the same EVM address without asking us. Source in
[contracts/src](contracts/src); addresses in
[lib/starknet/constants.ts](lib/starknet/constants.ts).

**The two escrow classes are not the same.** Sepolia's predates the
`EscrowState` enum and the constructor and deposit assertions added with the
private-refund revision, so mainnet is the first network running that source.
Both are listed rather than quietly reconciled; see
[docs/escrow-v2-private-refund.md](docs/escrow-v2-private-refund.md).

## Send private USDC to an Ethereum wallet

`MorokEscrowV2` gets two products out of one rule, `get_caller_address() == entry.owner`:

- **a bearer link**, whose seed *is* an EVM private key, so holding the link is holding the account that can claim;
- **an invoice** addressed to a named EVM wallet, found through an opt-in on-chain index — there is no link to send at all.

The recipient needs an EVM wallet that can sign EIP-712, and nothing else: no
Starknet wallet, no STRK, no gas, no deployed account — the deploy and the
claim ride in one relayer-paid transaction — and no pool registration, because
the payout is an ordinary ERC20 transfer to a destination the owner names.

What this protects is the **sender**. The deposit is relayed, and the refund
path uses an independent per-entry recovery key, so the sender's own address is
never the entry's refund owner. The amount, the recipient and the expiry are
public on chain by design, and the README says so rather than letting "private"
cover more than it does.

Verified: 12 Starknet Foundry contract tests, a 12-of-12 on-chain probe and a live claim
on Sepolia, with the mainnet contract deployed and read back. Design, measured
costs and the Privacy Cash comparison are in
[docs/evm-escrow-invoices.md](docs/evm-escrow-invoices.md).

## How it works

1. Connect MetaMask - or Ready X, if you have one. `/start` derives your Starknet account, deploys it, buys the STRK for activation out of your USDC, and registers you with the pool, naming who pays at every step.
2. Shield USDC once to move it into the pool.
3. Then either **send**: park private USDC behind a one-time link or address it to somebody's EVM wallet on `/stash`. Or **receive**: publish one open-amount donation QR on `/sell`.
4. The recipient opens `/claim`, connects the wallet you addressed it to, and collects. They need no Starknet wallet, no STRK and no gas.

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
| Enable Private (register in the pool) | 6 | 2.68-4.72 | 8.68-10.72 | `0x21b12f4dbe…f22d0` |
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

## Bridging back out, without holding STRK

Leaving Starknet used to need STRK for gas, which fails exactly where it
matters: somebody who just unshielded their last USDC has none left to move it
with. The burn now goes out as an **outside execution** - the owner signs the
intent with MetaMask, MorokPay's relayer submits it and pays.

Outside execution rather than a plain relayer transaction because
`deposit_for_burn` burns from the caller. A relayer sending its own transaction
would bridge its own USDC; `execute_from_outside_v2` keeps
`get_caller_address()` as the owner's account while somebody else pays. Done on
mainnet, MetaMask signing, the account never touching its own STRK:

| | |
| --- | --- |
| Burn on Starknet | [`0x37d04c3c…59455`](https://voyager.online/tx/0x37d04c3c500263fda23f21abb9680c03d5123fdb0e1efd20e6cedad31259455), `SUCCEEDED`, block 14523313 |
| Submitted and paid by | MorokPay's relayer, `2.12 STRK` |
| Owner's STRK before and after | `3.7541` — untouched |
| Circle | attested `complete`, domain 25 → 6 |
| Bridged | `2.007718 USDC`, Circle's fee `0.002409` |
| Landed on Base | at the owner's own wallet |

**Fast Transfer is worth its 12 basis points here.** An earlier burn at the
finalized threshold ([`0x34e7a8b3…34bbf`](https://voyager.online/tx/0x34e7a8b3bf9d27c4e9eda3a8f23b05198d8d009bde9191f9710e905d1834bbf))
was still `pending_confirmations` hours later, because finalized on this
direction means Starknet's own finality. The same route at threshold 1000
attested in minutes for a quarter of a cent. Both are on chain; the contrast is
the argument.

The mint on Base stays the user's own transaction and needs ETH there. Circle
attests but does not deliver — their guide is explicit that a consumer "must
query this attestation and submit it onchain" — and paying gas for somebody who
already holds an EVM wallet would be doing the wallet's job. The dialog says
so rather than letting the sponsored half imply both, and says the bridge
itself is public: the amount and both addresses are visible on each chain.

## STRK20 integration surface

Against the five things the depth criterion names:

| | in MorokPay | evidence |
| --- | --- | --- |
| Shielded balances | Discovered in-page from a viewing key on both rails; the balances sidebar reads them live | shield `0x506c1e0665…da2a`, unshield `0x114fb5ad4a…9929` |
| Private transfers | Donation pay, contest payouts, and the escrow park all move value note-to-note inside the pool | four payout hashes under [the contest](#private-donation-contest) |
| Anonymizer contracts | `MorokEscrow` and `MorokEscrowV2` implement `privacy_invoke` and return `OpenNoteDeposit`, so the pool itself calls them and hands the note over. Two products from one rule; source in [contracts/src](contracts/src) | the five hashes in [`strk20.json`](strk20.json) |
| The Privacy SDK | Used directly in the browser on the MetaMask rail - proving, note discovery and the viewing key never leave the page, and never reach our server | [docs/evm-account-portability.md](docs/evm-account-portability.md) |
| Accounts derived rather than installed | A Starknet account deterministic in an EVM address, plus a separate receive account behind a QR so the creator's main account is never the one published. Not stealth addresses in the per-payment sense, and the README does not claim they are | factory `0x07ead3a8…627aa`, deploy `0x6ab36fb2b6…3894` |

## What runs where

| | Starknet Mainnet | Sepolia |
| --- | --- | --- |
| Donation QR, private pay, activity | Ready X · MetaMask | Ready X · MetaMask |
| Private balances | Ready X · MetaMask | Ready X · MetaMask |
| Shield / unshield in the app | Ready X · MetaMask | Ready X · MetaMask |
| Send a public balance out to an exchange | Ready X · MetaMask | Ready X · MetaMask |
| Relayed first donation, so the donor is never named | both rails | both rails |
| Anonymous receive account behind a QR | MetaMask | MetaMask |
| Base → Starknet top-up over CCTP | Ready X · MetaMask | Ready X · MetaMask |
| Starknet → Base exit, relayer pays the burn | MetaMask | MetaMask |
| Send private USDC to an EVM address | Ready X · MetaMask | Ready X · MetaMask |

`/privacy-sdk-lab` still runs every step one at a time with the proof, the fee
and the resource bounds shown explicitly. It is a diagnostic surface now, not
the way in; the balances sidebar links to it quietly.

Mainnet differs from Sepolia by design: Sepolia sponsors a new account with 20
test STRK, mainnet never sends STRK to a connecting address and requires it to
be funded first.

`strk20.json` lists five succeeded mainnet transactions, each of which touched
the live STRK20 pool through one of our own deployed contracts.

This project answers [RFP-09 — one-click privacy from any
chain](https://strk20.starknet.io/rfp/cross-chain-privacy-hub), and as of
2026-09-07 it answers the whole of it on mainnet: a Starknet account generated
deterministically from an EVM wallet, bridging in from Base over CCTP, holding
privately, and **bridging back out to Base** - all without the user holding
STRK or thinking about Starknet, which is that RFP's own test. The round trip
is measured below. The donation QR also answers
[RFP-12](https://strk20.starknet.io/rfp/private-subscriptions), though without
the recurring charges and session keys that RFP is really about.

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

## Private donation contest

Ran 2026-08-31 to 2026-09-01: $20 in USDC split by rank among however many
people finished the entry - open MorokPay, activate STRK20, publish a
donation QR - capped at 7. Four people finished, so the split rescaled to
$7.50 / $5.00 / $3.75 / $3.75. Ranking came from
`sha256(seed + entry-list-hash + address)`, where the seed was the first
Starknet mainnet block produced after entries closed - a number nobody could
know while entering. Full mechanism, the allocation script, and the terms are
in [docs/private-contest.md](docs/private-contest.md).

All four prizes were paid as private donations to the winners' own QR
addresses, submitted from MorokPay's relayer - so the payout, like every
first transfer to a new recipient, publishes only who received it, never what
or from whom:

| transaction |
| --- |
| `0x17c5185dd9599b25b447a56495407ace6a8a58ab108975f2ab6a305d3b10571` |
| `0x460d5b8b37053b72f82faf1b7ae95e87da3549ea45ca97af334520b5337aa11` |
| `0x6d39a179dbbc6a55423ab41b2b6e9e7b69cec590d4c103c3ad536f3c5e3a17b` |
| `0x13896879c847ee87ff8fec808665c7b08d9786f539f43f79c9235d72ee4f035` |

Consistent with the contest's own rule against publishing an address-to-prize
table, no mapping is given here either - each winner can recompute their own
rank from the published seed and entry-list hash.

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
- MorokPay's fee is planned for the in-app unshield step, not for each private donation; see [docs/fees.md](docs/fees.md).
- `lib/starknet/tokens.ts` already carries mainnet `strkBTC` alongside USDC, and
  amount parsing is decimals-aware. The donation request format is USDC-only, so
  private BTC donations remain a follow-up rather than a shipped feature.
- DonationPot is a design-only follow-up; see [docs/donation-pot.md](docs/donation-pot.md).
- Funded onboarding is **built and done on mainnet**. `/start` is one screen
  with four steps that each name who pays: bridge from Base (ours), deploy the
  account (ours), buy STRK with a swap that pays its own gas out of the USDC it
  sells, and register with the pool (the user's - it carries a proof that
  cannot be relayed). The research behind it is in
  [docs/funded-onboarding.md](docs/funded-onboarding.md).
- Escrow V2 is deployed on both networks and wired into `/stash` and `/claim`.
  A live claim has run on Sepolia, and three mainnet transactions ran through
  the contract the same afternoon it was deployed; their hashes are in
  `strk20.json`.

## Roadmap

Arriving with USDC on Base and reaching a private balance without ever buying
STRK by hand used to be the nearest piece. It shipped: `/start` does it, and
the split it settled on is forced by a constraint rather than a preference - a
shield cannot be relayed, because STRK20 passes its proof as a
transaction-level extension and SNIP-9 outside execution has no field for one.
So the relayer bridges and deploys, the swap pays its own gas out of the USDC
it sells, and the user's own account pays for the registration.

The nearest piece now is collapsing bridge and shield into one **Make private**
button, which is held back by the same economics: the bridge is ours at about
1 STRK, the shield is theirs at 11.31, so somebody arriving from Base with no
STRK cannot finish the chain and belongs in onboarding instead.

That, and what else is open - the anonymous receive account on Ready X, batched
payouts, where MorokPay's own fee belongs - is in
[docs/roadmap.md](docs/roadmap.md).

Links made by the earlier `MorokEscrow` remain redeemable at `/claim`. New
links come from `MorokEscrowV2` and are created on `/stash`; the two are
separate contracts with separate rules, and a link from one is never read as a
link to the other.

## Run locally

Requirements: Node.js 22+ and the [Ready X extension](https://chromewebstore.google.com/detail/ready-x/dlcobpjiigpikoobohmabehhmhfoodbb).
The `/privacy-sdk-lab` onboarding and the Sepolia Donate/My QR EVM connector
support MetaMask or another compatible injected EVM wallet.

```bash
npm install
npm run dev
```

The app has working RPC defaults. Copy `.env.example` to `.env.local` when you
need to override RPC endpoints or configure the server-only deployment
relayers - Sepolia's sponsors new accounts, mainnet's only pays its own gas.
Never expose a relayer private key through a `NEXT_PUBLIC_` variable.

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
- [Send private USDC to an EVM address: design and costs](docs/evm-escrow-invoices.md)
- [Escrow V2 private refund](docs/escrow-v2-private-refund.md)
- [Who pays, and how much](docs/who-pays.md)

## License

MIT
