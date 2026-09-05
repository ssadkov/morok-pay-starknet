# Escrow invoices for an EVM address

Status: designed 2026-09-03, **not built** - but every mechanism it depends on
has now been run end to end on Sepolia, by
[escrow-rail-probe.mjs](../scripts/escrow-rail-probe.mjs) and
[sponsored-claim-probe.mjs](../scripts/sponsored-claim-probe.mjs). Facts not
measured here are cited to the document that verified them.
The Cairo escrow that exists today is
[contracts/src/escrow.cairo](../contracts/src/escrow.cairo), now live on
**both** networks - mainnet `0x06199365a4...b698f`, deployed 2026-09-04 for
6.67 STRK, same class hash as Sepolia. What is not built is the V2 below:
ownership by EVM address, a public claim, expiry and refund.

## What this is

Two products that turn out to be one primitive:

- **An invoice to an EVM address.** "Give me any EVM address and private money
  will be waiting for you." The sender parks USDC for `0xADDR`; only the holder
  of that Ethereum key can take it.
- **A bearer code.** A stash - one code, one activation, no address needed in
  advance. This is the existing claim-link idea, rebuilt so it works without a
  Starknet wallet.

They are the same contract and the same claim path, because in the second case
**the link itself is an EVM private key**. See
[One contract, two products](#one-contract-two-products).

## Measured on Sepolia, 2026-09-03

[scripts/escrow-rail-probe.mjs](../scripts/escrow-rail-probe.mjs) submits both
halves of the rail and reports which one the pool accepts.

**The deposit leg works. This design's go/no-go is green.** A pool withdrawal
into the escrow plus `privacy_invoke(Deposit)` - no open note anywhere in it -
succeeded from `spare`:

| | |
| --- | --- |
| transaction | `0x3c12c536e2a6417001549f587c2b25dc5be0d724124e8b85e9f6dd6eaa91617` |
| parked | 0.05 STRK, entry `0x58e776a4…3575`, `claimed: false` |
| cost | **4.67 STRK** - 2.0 pool fee (Sepolia; mainnet is 6) plus 2.67 gas |

So screening does not touch a withdraw-plus-invoke batch, which is what the
sender side of both products is built out of.

**The claim leg works too, and that was not expected.** The claim created an
open note owned by the claimer and had the escrow deposit into it - the exact
shape [relayed-submission.md](relayed-submission.md) reads as blocked by the
pool's open-note screening policy:

| | |
| --- | --- |
| transaction | `0x7954b7dafc008941529be4530924c22e5c8cfad690eed5e27c8400a4c4c7b87` |
| result | `SUCCEEDED`, entry `claimed: true`, `escrowed_total(STRK)` back to 0 |
| cost | **4.64 STRK** - 2.0 pool fee plus 2.64 gas |
| events | the escrow's `Claimed`, and the pool's open-note deposit with `depositor` = the escrow |

**So the version risk in relayed-submission.md is not enforced as written.**
`get_open_note_screening_policy` returns `0` for the escrow - and, measured
here, returns `0` for the invoices helper and for an address that is not a
contract at all, so `0` is simply the unset default for everything. An
open-note deposit naming the escrow as depositor went through under that same
`0`. Either the variant order in the source reading is not what the deployed
pool uses, or the policy is not enforced on this deployment. Both docs should
say measured rather than reasoned from here on.

**What this changes.** It reopens a private claim as a real option - on
Sepolia's newer pool, which is the one mainnet will upgrade to, so it is not
living on borrowed time the way risk 4 said. The next probe took that further
and made it the default: see
[the sponsored private claim](#the-sponsored-private-claim-measured-end-to-end).

## Done on mainnet, 2026-09-05

A stranger with an empty MetaMask collected private USDC, and paid nothing.

| | |
| --- | --- |
| escrow | `0x06199365a4...b698f`, entry `0x79a65b1e...`, 1.000000 USDC |
| claim | `0x2f716fbf...346997` |
| after | entry `claimed`, `escrowed_total` and the contract's own USDC balance both zero |
| the claimer | registered in the pool by that same transaction, public key `0x5a151c6f...` |
| paid by MorokPay | **9.56 STRK ≈ $0.26** for the account deploy and the claim together |

Cheaper than the $0.27-0.33 extrapolated below, and the registration happened
inside the claim exactly as the Sepolia probe said it would. The claimer's
account never held STRK at any point.

Three things the run exposed, all fixed in the same commit: the claim button
said "Claiming" through two wallet prompts and a minute of proving; the
session's `privacyReady` went stale the moment the claim registered the
account, so the sidebar offered - and would have charged 6 STRK for - a second
registration; and the receipt lived only in a toast that disappeared.

## The sponsored private claim, measured end to end

[scripts/sponsored-claim-probe.mjs](../scripts/sponsored-claim-probe.mjs), run
on Sepolia 2026-09-03 with a freshly generated EVM key that had never touched
Starknet. **It works, and it collapses into one transaction.** Register, the
open note, and `privacy_invoke(Claim)` all fit in a single action set, a single
proof, and a single transaction submitted and paid for by the relayer:
[`0x413807d2c8ba…c1ca`](https://sepolia.voyager.online/tx/0x413807d2c8ba1a9e8ff8010fbd7f1819417b222ea6a6f4d97a61f49dd3cc1ca).

The recipient's account **never held a single wei of STRK**, start to finish,
and ended with 0.05 STRK in its private balance.

| step | who paid | Sepolia cost | wall clock |
| --- | --- | ---: | ---: |
| deploy the recipient's account through the factory | relayer | 0.85 STRK | 17.4 s |
| upgrade it to the STRK20-compatible class | relayer | 1.56 STRK | 16.1 s |
| sender parks 0.05 STRK in the escrow | sender | 4.65 STRK | 31.8 s |
| **register + open note + claim, one tx** | relayer | **4.90 STRK** | 7.8 s proof + 18.4 s chain |

**"Registration takes 30 seconds" is accurate rather than aspirational.** What
the recipient waits for is 26.2 s: one EIP-712 signature (instant), 7.8 s of
proving, 18.4 s to inclusion. Everything before that happens at
invoice-creation time - see the aging constraint below.

### Three things this probe found the hard way

**The Sepolia factory still deploys the legacy account class.** Mainnet's
points at `0x0697437b…586e` already; Sepolia's hands out
`0x39ffe6e5…7f55`, which cannot validate the pool's `CallSet` - the pool
answered `INVALID_SIGNATURE`. The legacy class does expose
`execute_from_outside_v2`, so the fix is itself sponsorable: the recipient
signs an upgrade intent and the relayer pays (1.56 STRK). **On mainnet this
step does not exist**, so mainnet is cheaper here than Sepolia, not dearer.

**The proving block must see the compatible class, not merely a deployment.**
A proof is simulated against `latest - 10`. An account that was still legacy
at that block is validated by the legacy class, so an upgrade that had already
landed on chain still produced `INVALID_SIGNATURE`. Deploy *and* upgrade have
to age. This is the strongest argument for doing both at **invoice-creation
time**: by the time anyone follows the link, the account is aged, and the
recipient's 26 seconds contain no block waiting at all. On Sepolia the aging
was free because the sender's park step took 32 s; mainnet blocks are slower
and it would not have been.

**A fresh account needs two setups, not one.** The pool wants a channel *and*
a per-token subchannel; supplying only the channel returns
`SUBCHANNEL_NOT_FOUND`. `setup` on the builder pushes `openChannels`, `setup`
on the token sub-builder pushes `openTokenChannels`. Both go in the same
action set.

## What this costs on mainnet

Priced at **$0.02724/STRK** (AVNU quote, 2026-09-03 - it was $0.0263 on
2026-08-31, so reprice again before quoting). Mainnet's pool fee is **6 STRK**
per `apply_actions`, re-read on chain 2026-09-03; Sepolia's is 2, which is the
only reason the Sepolia numbers above look cheap.

Rows marked *measured* come from mainnet receipts already recorded in
[who-pays.md](who-pays.md) and [the README](../README.md). Rows marked
*extrapolated* take the pool fee as certain and the gas from this probe's
Sepolia measurement; gas prices move, so treat them as a range.

### 1. A sender arriving from zero

| step | who pays | STRK | USD |
| --- | --- | ---: | ---: |
| deploy the derived account *(measured)* | MorokPay | 0.97 | $0.03 |
| register in the pool *(measured)* | sender | 8.68-10.72 | $0.24-0.29 |
| shield the USDC *(measured)* | sender | 11.31 | $0.31 |
| park it in the escrow *(extrapolated)* | sender | ~8.7 | $0.24 |
| **sender's total** | | **28.7-30.7** | **$0.78-0.84** |

**Shield and park do fit one action set** - measured 2026-09-03,
[`0x2f209f1ebb…a504`](https://sepolia.voyager.online/tx/0x2f209f1ebbb90aa42c860d3a555b15b9472e7c8cad8711a81e96c16c75a504),
4.77 STRK on Sepolia against ~10 for the same work in two transactions. On
mainnet that is one 6-STRK pool fee plus a second transaction's gas, so about
**$0.24 saved per send**.

With one condition, and it is the interesting part: **an action set that
deposits and withdraws but spends no note is refused with
`NO_REPLAY_PROTECTION`.** Nothing is nullified, so nothing stops the set being
replayed. Spending one existing note supplies the nullifier and `surplusTo`
returns its value immediately, leaving the private balance unchanged.

So the saving belongs to a **returning** sender, who has a note to spend. A
first-time sender has nothing to nullify and must shield in its own
transaction whatever else changes - which is why the from-zero total above is
unchanged, and why a returning sender's send costs ~$0.25 rather than ~$0.55.

### 2. A recipient arriving from zero - all of it sponsored

| step | who pays | STRK | USD |
| --- | --- | ---: | ---: |
| deploy the derived account *(measured)* | MorokPay | 0.97 | $0.03 |
| upgrade the class | - | 0 on mainnet | - |
| register + open note + claim, one tx *(extrapolated)* | MorokPay | 9-11 | $0.25-0.30 |
| **MorokPay's total** | | **10-12** | **$0.27-0.33** |

The recipient pays **nothing** and needs no STRK, no exchange, and no Starknet
wallet. A public claim instead of the private one is ~1.3 STRK (**$0.04**),
because it carries no pool fee and no proof.

### 3. The full circle, nobody from zero

| step | who pays | STRK | USD |
| --- | --- | ---: | ---: |
| sender shields more USDC *(measured)* | sender | 11.31 | $0.31 |
| sender parks it *(extrapolated)* | sender | ~8.7 | $0.24 |
| recipient claims - already registered, channel exists *(extrapolated)* | MorokPay | 7-9 | $0.19-0.25 |
| recipient unshields *(measured)* | recipient | 10.41 | $0.28 |
| recipient sends it to an exchange *(measured)* | recipient | 1.33 | $0.04 |
| **all of it** | | **~39-41** | **~$1.08** |

Of which the users pay ~$0.87 and MorokPay ~$0.22. A sender who already holds
a private balance skips the shield, and the circle drops to ~$0.70.

## What can actually be charged, and how that compares

The dominant cost is not ours and not gas: it is the pool's flat **6 STRK
($0.16) per `apply_actions`**. Every design decision that removes one pool
interaction is worth more than any gas optimisation, which is why collapsing
register + claim into one transaction matters and why shield + park should be
tried next.

Privacy Cash on Solana is the closest comparable, and its numbers are public:
deposits free, withdrawals **0.35% plus a flat 0.006 SOL** relay charge, no
liquidity providers to pay, so fees are all revenue. Per DefiLlama on
2026-09-03: **$3,078** in the last 24 h, **$28,849** over 7 days, **$83,117**
over 30 days, **$1,032,277** all time - against roughly $121M of private
transfers in its first 100 days.

Apply their rate to our cost base and one number falls out:

> At 0.35%, a **$100** transfer earns **$0.35** while a sponsored
> from-zero receive costs us **$0.27-0.33**. That is break-even, not a margin.

So a percentage alone does not work on Starknet at a 6-STRK pool fee - and
Privacy Cash's own structure already says as much: their 0.006 SOL is a *flat*
charge that covers relaying, separate from the percentage.

### Where the crossover is

The comparison that matters is not our cost against their cost, it is what a
user pays each of us for the same job: money in, money out at an unlinked
address.

**Privacy Cash**: deposit free, withdraw `0.35% x A + 0.006 SOL`. At
**SOL $104.34** (Kraken, 2026-09-03) that flat part is **$0.63** - much the
larger half for any ordinary transfer.

**MorokPay**, with a returning sender and a from-zero recipient:

| | user pays | note |
| --- | ---: | --- |
| sender shields and parks, one action set | $0.245 | measured above |
| recipient receives | $0 | we sponsor $0.27-0.33 |
| recipient unshields *(measured)* | $0.28 | |
| recipient sends it out *(measured)* | $0.04 | |
| **user-borne, flat, no percentage** | **$0.565** | plus our fee `F` |

Setting the two equal - `0.565 + F = 0.0035A + 0.626` - gives the transfer
size above which **the user pays us less than they would pay Privacy Cash**,
while we still collect `F`:

| our fee `F` | our margin over the sponsored receive | crossover |
| ---: | ---: | ---: |
| $0.33 | ~$0 | **$77** |
| $0.50 | ~$0.20 | **$125** |
| $1.00 | ~$0.70 | **$268** |
| $2.00 | ~$1.70 | **$554** |

And past the crossover the gap only widens, because their price has a
percentage in it and ours does not. At a $1 fee: a **$1,000** transfer costs
$1.57 with us against $4.13 with them; a **$10,000** transfer costs the same
$1.57 against **$35.63** - **23x**.

The mirror image is equally true and should not be buried: **below roughly
$77-125 we are the expensive option**, because our costs are flat and theirs
are proportional. A $20 transfer costs $0.70 through Privacy Cash and $0.90
through us at a break-even fee.

That is the whole strategy in one line: **flat costs beat proportional costs
above a threshold and lose below it, so charge a flat fee, set a minimum, and
serve everything under the minimum on the public claim** - which costs $0.04
to serve rather than $0.30, and is the same contract path.

The same split Privacy Cash uses is the right one here:

- a **flat fee at the escrow deposit** that covers the sponsored receive - and
  the deposit is the public edge where [fees.md](fees.md) already decided our
  fee belongs, and where it is not bypassable because the escrow is our
  contract;
- a **percentage on top** for larger amounts, where it stops being the only
  thing paying for the rail;
- a **minimum transfer size**. Sponsoring a $5 transfer spends 6% of it, and
  [risk 3](#3-the-relayers-gas-is-an-open-attack-surface) already needs a floor
  for a different reason. One floor answers both.
- **the public claim as the cheap tier, not the fallback for failures.** At
  $0.04 versus $0.30 it is 7x cheaper to serve, which is a reason to offer it
  on its own merits and to let the private claim be the paid upgrade.

Sources: [Privacy Cash on DefiLlama](https://defillama.com/protocol/privacy-cash),
[the protocol's docs](https://privacycash.mintlify.app/),
[its first-100-days figures](https://solanafloor.com/news/privacy-cash-over-121-m-in-private-transfers-during-its-first-100-days).

## The primitive

An escrow entry is owned by an EVM address. Nothing about the owner is a secret
we hold; ownership is proved the same way it is proved everywhere else on this
rail.

**Derivation.** The factory already maps any EVM address to a Starknet account
address deterministically and permissionlessly -
`get_expected_account_address(eth_address)`, whether or not it is deployed
([evm-account-portability.md](evm-account-portability.md), factory
`0x7ead3a89ae0a67ed6ba18caa1b9643437ff9432bab66ab0b2a27e46e0c627aa`). So "an
entry for `0xADDR`" is an entry keyed by the Starknet address derived from
`0xADDR`.

**Claim, with no new cryptography.** The escrow does not verify an Ethereum
signature. It asserts `get_caller_address() == entry.owner`, and the EIP-712
verification is done by the account class StarkWare wrote
(`0x0697437b25b81bcdd2d1b231d3b8670849fb318555903dbc2fefce2a1a35586e`). There
is no secp256k1 or keccak code in a contract that holds money.

**The recipient pays nothing.** That account class exposes
`execute_from_outside_v2` (SNIP-9), confirmed against the deployed class in
[funded-onboarding.md](funded-onboarding.md), and
[lib/privacy/eth712-outside-execution.ts](../lib/privacy/eth712-outside-execution.ts)
already signs that struct through MetaMask - it is what the gasless AVNU swap
runs on. So the recipient signs an intent and MorokPay's relayer submits it and
pays the gas.

**One activation.** The existing `EscrowEntry.claimed` flag already makes an
entry single-use; the claim asserts `!entry.claimed` and sets it.

## Public claim or private claim - both, priced differently

This section previously argued the claim must not touch the pool at all. Two
rounds of measurement took that apart, and the honest position is now a
priced choice rather than a constraint.

**The onboarding argument is gone.** It assumed the recipient's registration
could not be hidden. It can: register, the open note and the claim fit in one
sponsored transaction, and the recipient's account never holds STRK - see
[the sponsored-claim probe](#the-sponsored-private-claim-measured-end-to-end).
Nothing about the 6-STRK fee or the viewing key ever reaches them.

**The screening argument is smaller than written.** Both escrow legs run today,
including the open-note deposit that
[relayed-submission.md](relayed-submission.md) read as blocked. What survives
is ownership, not breakage: `open_note_depositor_screening_policies` is set by
the pool's app governor, so a private claim rail is one StarkWare *can* close
for our contract address. That argues for keeping the public claim implemented
and reachable, not for making it the only way to receive.

**What remains is cost, and it is a 7x difference.** A sponsored private claim
is $0.27-0.33 for a recipient arriving from zero; a public claim is about
$0.04, because it carries no pool fee and no proof. So:

- **private claim** - the default experience, and the thing worth charging for;
- **public claim** - the cheap tier and the fallback, one code path either way,
  because both reduce to `get_caller_address() == entry.owner`.

Funding the entry is unaffected either way: that is a pool **withdrawal** plus a
helper invoke, and it was the first leg ever measured here.

## What the recipient actually does

Measured, not projected - the timings and signature counts below are from
[the sponsored-claim probe](#the-sponsored-private-claim-measured-end-to-end).

| Step | Who pays | Signatures | Wall clock |
| --- | --- | --- | ---: |
| Connect MetaMask, app derives the Starknet address | - | - | instant |
| The account is already deployed and aged, from invoice-creation time | MorokPay | - | - |
| Sign the viewing-key request | - | 1 | instant |
| Sign the action set | - | 1 | instant |
| Prover returns one proof for register + note + claim | MorokPay | - | 7.8 s |
| Relayer submits; the chain accepts | MorokPay | - | 18.4 s |
| **What the recipient waits for** | | **2** | **26.2 s** |

**No STRK at any point, and the recipient's account never holds any.** Two
MetaMask signatures, both instant. What the money costs us and what a public
claim costs instead are in [What this costs on mainnet](#what-this-costs-on-mainnet).

## Onboarding, before and after

Today's EVM receive path, from the measured table in [the README](../README.md):

```
connect -> derive -> deploy -> sign the viewing key -> Enable Private (6 STRK fee + 2.68-4.72 gas)
```

plus `EvmOnboardingGate` refusing mainnet onboarding below 15 STRK and telling
the user to go buy an unrelated token - named in
[funded-onboarding.md](funded-onboarding.md) as the largest single drop-off in
this path.

The escrow claim path:

```
connect -> derive -> relayer deploys ($0.03) -> sign one intent -> relayer submits -> USDC arrives
```

The privacy tier does not disappear, it moves: the recipient can register in the
pool later, at their own pace and expense, because they now hold funds to pay
for it with. Onboarding stops being a toll gate in front of the money and
becomes an upgrade behind it.

## One contract, two products

A bearer code needs no separate contract. Derive an EVM keypair from the link
seed in the browser; the entry is owned by that ephemeral address; the claimer
signs the intent with the key the link carries. Identical contract, identical
relayer, identical claim path - the recipient needs **no wallet at all** and
still names any destination they like.

This is strictly safer than a hash-in-link scheme. Under
`poseidon([ESCROW_TAG, secret])` as it exists today, the secret is bare bearer
authorization revealed in the claim's calldata, and the destination is a
parameter the *submitter* chooses - so a relayer, or anyone who sees the secret
before inclusion, can redirect the funds. With the key in the link, the
destination is inside the signed intent and cannot be substituted by whoever
submits it. **A link that is a key can be relayed safely; a link that is a hash
cannot.**

Note what that rules out: a hash-in-link is not a cheaper version of the same
thing, it is a *third* claim rule in the contract
(`poseidon([TAG, secret]) == commitment`) with a redirect hole under relaying.
Key-in-link and invoice-to-an-address share one rule -
`get_caller_address() == entry.owner` - and the contract never learns which
product it is serving.

### Build the bearer code first

Counter-intuitively, the link version is the better first build, not the
address version:

1. The recipient needs no wallet at all, which is the cleanest possible demo.
2. It publishes no address, so [risk 1](#1-who-has-money-waiting-becomes-publicly-enumerable)
   - and the enumerability trade-off it forces - can be decided later instead
   of blocking the first version.
3. It exercises exactly the same contract path, so invoice-to-an-address
   afterwards is a form field, not a second integration.
4. Both sides can be generated locally, so testing needs no second wallet and
   no faucet round trip.

## The address is the identity, the chain is not

Worth stating because it sounds too good: the derived Starknet account depends
only on the EVM **address**, not on which EVM chain the holder uses it on -
`eth_address` is the salt in the derivation
([evm-account-portability.md](evm-account-portability.md)). One EVM address
resolves to one Starknet account whether its owner thinks of themselves as an
Ethereum, Base or Arbitrum user, and the account's validator never consults an
external chain. Chain-agnostic identity is free here, not a feature to build.

The `chainId` in the viewing-key derivation is the one exception, and only for
the privacy tier: it is a domain-separation value, so the same EVM address
signing on a different EVM chain derives a different viewing key. A public
claim derives no viewing key at all, so nothing about it is chain-dependent.

CCTP's chain list is a separate axis: it governs where USDC can enter and
leave, not who owns what. Supporting more CCTP domains widens the funding and
payout ends; it does not touch the identity above.

## Where the fee goes

The escrow deposit is a pool withdrawal, which is exactly the public edge where
[fees.md](fees.md) already decided MorokPay's fee belongs - and this design
lands the sender's fee there without adding anything to a private donation.

It also fixes the enforcement hole fees.md admits to. The in-app unshield fee is
bypassable, because a user can unshield in Ready directly. The escrow is our
contract: an entry cannot be created without passing through it, so the fee is
charged where the value actually moves. Take it as an explicit transfer call
inside the batch the sender signs, so it is visible before approval and never
held in custody.

**Price the service, not the anonymity.** Sponsored gas, relayed submission and
deferred delivery are services and can carry a fee. A premium *for anonymity*
positions MorokPay as an anonymity provider rather than an interface to a public
pool, which is the framing that draws attention to a front-end. Same mechanism,
same revenue, different exposure.

## V2: what to build next

V1 is deployed on both networks and **holds nothing** - the mainnet round trip
emptied it - so V2 is a clean new contract at a new address, not a migration
and not an upgrade. V1 has no upgrade entry point and never will; anything
parked in it stays claimable by its secret alone.

### One rule, and it covers both products

The whole design collapses to `get_caller_address() == entry.owner`. There is
no separate bearer mode, because a bearer link's owner is simply an ephemeral
EVM address derived from the link seed. "With a recipient address" and
"without one" are the same entry shape and the same claim path; the only
difference is whose address the sender puts in, and that is decided in the
browser, not in Cairo.

That is worth stating because it is the argument against the obvious
alternative. Keeping V1's `poseidon([TAG, secret])` rule alongside an owner
rule would be a second authorisation path in a contract holding money, and the
secret-based one cannot be relayed safely: the claim reveals the secret in
calldata and the destination is chosen by whoever submits, so a relayer can
redirect it. One rule is both smaller and safer.

### The entry

```cairo
struct EscrowEntry {
    token: ContractAddress,
    amount: u128,
    owner: ContractAddress,        // who may claim
    refund_owner: ContractAddress, // who may take it back after expiry
    expires_at: u64,
    claimed: bool,
}
```

1. **`claim(commitment, destination)`** - external. Asserts caller is `owner`,
   not claimed, not expired, then `IERC20::transfer(destination, amount)`.
   The destination is a parameter rather than the caller so a claimer can send
   straight on - to a bridge helper, an exchange, anywhere.
2. **`privacy_invoke(Claim)` stays** for the private-note path. It is measured
   and it works on both networks; it is a tier, not the default.
3. **`refund(commitment)`** - external, after `expires_at`, caller must be
   `refund_owner`. Symmetric with the claim, so no new mechanism. **This ships
   in the first version.** Today a lost link is money gone forever, with no
   path back for anyone including us.
4. **Discovery index** - `entries_of(owner) -> u32`, `entry_at(owner, i)`, so
   connecting a wallet shows what is waiting without a link. Read
   [risk 1](#1-who-has-money-waiting-becomes-publicly-enumerable) first: this
   is the feature that makes "who has money waiting" publicly queryable, and
   it is optional in a way the rest of this list is not.
5. **A minimum entry amount.** See below - this one is now urgent rather than
   theoretical.
6. Keep the funding assert. The balance-versus-totals check in
   `EscrowOperation::Deposit` is what stops a caller booking an entry the pool
   never funded, and it is the reason the mainnet deposit could be trusted.

### Expiry semantics, so they need no second reading

Before `expires_at`: `claim` works, `refund` does not. After: `claim` fails,
`refund` works. No overlap, no grace period, nothing that depends on who asks
first.

### The hole a minimum would close, which is open right now

The deploy route sponsors a Starknet account when it can see a funded,
unclaimed entry behind the commitment
(`app/api/privacy-sdk/deploy/route.ts`). There is **no floor on that entry**.
Parking one cent buys a free account deploy at MorokPay's expense.

It is not economic today - creating any entry costs the sender the 6 STRK pool
fee (~$0.16) against a ~$0.03 deploy - so the attack loses money five times
over. That is an accident of the pool's fee, not a defence we built, and it
stops being true the moment the fee drops or we subsidise the sender side. A
floor belongs in the contract, where it cannot be forgotten by a caller.

## Receiving on an EVM chain, in the same screen

Worth separating what exists from what does not, because most of it exists.

**What is built.** `lib/cctp/` has both directions: `receiveMessageCall` for
Starknet-inbound and `depositForBurnCall` for Starknet-outbound, both
unit-tested, and `components/treasury/payout-panel.tsx` already drives
unshield → burn on Starknet → mint on Base. The claim's `destination`
parameter above is what lets the money go straight into that path instead of
sitting in the claimer's account first.

**What is sponsorable.** The Starknet burn is an ordinary public call, so the
relayer can submit `[approve, deposit_for_burn]` through
`execute_from_outside_v2` exactly as it submits the claim. The claimer signs;
we pay. No new mechanism.

**The one genuinely new cost, and it is not on Starknet.** Circle requires
somebody to call `receiveMessage` on the destination chain with the
attestation, and that costs gas *there*. Today payout-panel has the user do it
from MetaMask - fine for someone who already holds ETH on Base, and useless
for a claimer whose wallet is empty, which is the whole population this design
serves. Paying it for them means an **EVM relayer holding ETH on Base**: a
second key, a second balance to monitor, a second thing to rate-limit. That is
the honest price of "receives on their own chain and pays nothing", and it is
infrastructure rather than a feature.

**Sequencing follows from that.** The public claim in V2 is the prerequisite -
a claim into a private note cannot be bridged, because the money is in the
pool rather than in an account. So: V2 first, then the sponsored burn, then
the Base-side relayer if we decide to pay that leg. Each step is useful on its
own.

**Status of the surrounding claims.** CCTP inbound is Sepolia-only in the app
today ([the README's table](../README.md) marks mainnet as `-`), and no
Starknet → Base round trip is recorded on mainnet anywhere in these docs. The
code exists and is tested; the mainnet evidence does not. Do not promise this
leg until it has run once.

## What is already in the repo

| Piece | Where |
| --- | --- |
| Escrow Cairo, deposit path, funding assert, tests | [contracts/src/escrow.cairo](../contracts/src/escrow.cairo), [contracts/snforge/test_escrow.cairo](../contracts/snforge/test_escrow.cairo) |
| EVM to Starknet address derivation | [lib/privacy/eth712-account.ts](../lib/privacy/eth712-account.ts) |
| MetaMask-signed SNIP-9 intents | [lib/privacy/eth712-outside-execution.ts](../lib/privacy/eth712-outside-execution.ts), `signOutsideExecution` in [lib/privacy/evm-strk20-account.ts](../lib/privacy/evm-strk20-account.ts) |
| Relayer credentials, submission, rate limits | [lib/privacy/relay-submission.ts](../lib/privacy/relay-submission.ts), [lib/privacy/relay-limits.ts](../lib/privacy/relay-limits.ts) |
| Sponsored deploy | [app/api/privacy-sdk/deploy/route.ts](../app/api/privacy-sdk/deploy/route.ts) |
| Escrow reads, link format, claim UI | [lib/starknet/escrow.ts](../lib/starknet/escrow.ts), [lib/pay/escrow.ts](../lib/pay/escrow.ts), [app/claim/page.tsx](../app/claim/page.tsx) |

## Sizing

| Work | Size |
| --- | --- |
| `MorokEscrowV2` + snforge tests | 1 day |
| Declare, deploy, Sepolia end to end | 0.5 day |
| Sender UI: EVM address in, derived address resolved, `[withdraw to escrow, invoke deposit]` | 1 day |
| Recipient UI + a relay route for outside execution (no proof, so far simpler than `/api/privacy/relay`) | 1.5 days |
| Bearer-code variant on the same contract | 0.5 day |

**About 4 days.** The expensive part is not the code, it is deploying a
value-holding contract to mainnet for the first time.

## Risks, worst first

### 1. "Who has money waiting" becomes publicly enumerable

An entry findable by address without a secret is an entry anyone can look up for
any address they care about, and token and amount are public the whole time
funds sit in the escrow - already true of the contract today. Net effect:
**sender hidden, recipient and amount not.**

This is a law, not a bug: *discoverable without a link* implies *enumerable by
address*. Either salt the commitment and put the salt in the link - which kills
the "just give me your address" pitch - or accept it and position the product as
an **anonymous payout**, not a private escrow. Accepting it is the
recommendation; the alternative is a pitch that is false in exactly the part the
recipient cares about.

### 2. A wrong address loses the money permanently

Expiry and refund ship in v1. Beyond that: an exchange deposit address or a
contract derives a Starknet account controlled by whoever holds that EVM key -
for a CEX deposit address that is the exchange, and it will never claim. Check
whether the address has code on a public EVM RPC and warn.

### 3. The relayer's gas is an open attack surface

Free deploys and free claims for any address are our STRK to burn. The rate
limit is in-memory and per-process, which on serverless resets per instance
(roadmap item 5) - this is the flow that turns that from known into painful,
because it is public by design. Needs a minimum entry size (a ~$1 floor makes
farming $0.03 deploys pointless), a per-EVM-address budget, and a check that the
entry exists and is unclaimed **before** anything is sponsored.

### 4. A private tier could be gated by a policy we do not control

**Downgraded 2026-09-03 by measurement**, see
[Measured on Sepolia](#measured-on-sepolia-2026-09-03): a claim into an open
note succeeded on Sepolia's newer pool with the escrow as depositor, so this is
not the blocker it was written as. What remains is that
`open_note_depositor_screening_policies` exists in the pool and its values are
set by the app governor, not by us - so a private claim rail is a rail
StarkWare can close for our contract address, on either network, without our
involvement. Re-run the probe before promising it, and do not make it the only
way to receive.

### 5. Unsolicited funds are a known attack pattern

Pushing value at an arbitrary address is how address poisoning and
taint-transfer work, and a recipient may not want money out of a privacy pool
arriving at their public identity. Claims must stay strictly opt-in - they are,
by construction - and must never be auto-delivered.

### 6. The pool's auditor sees more than the public

Funding an entry is a withdrawal, and `Withdrawal.enc_user_addr` is decryptable
by the auditor ([relayed-submission.md](relayed-submission.md)). Never describe
this as anonymous with respect to StarkWare.

### 7. The intent is bearer authorization once it exists

Destination, escrow address, commitment, nonce and deadline must all be inside
the signed struct. `OutsideExecution { calls, caller, nonce, execute_after,
execute_before }` covers all of them; set `caller` to our relayer rather than
`ANY_CALLER`.

## Verify before building

Both legs are done. What is left:

1. Re-run the claim leg before shipping any private tier - the policy that
   permits it is the app governor's to change, and today's `SUCCEEDED` is a
   measurement of today.
2. Re-run [scripts/screening-policy-probe.mjs](../scripts/screening-policy-probe.mjs)
   against mainnet, which still runs the older pool without the policy map.
3. Reprice STRK. Every dollar figure here is $0.0263 from 2026-08-31.
4. Sender-side gap found while sizing: on the EVM rail
   `strk20InvokeTransaction` accepts **one** action and only
   transfer/deposit/withdraw ([lib/privacy/evm-strk20-account.ts](../lib/privacy/evm-strk20-account.ts)),
   so the withdraw-plus-invoke batch a deposit needs is Ready-only today. That
   restriction is part of the sender UI day, not a surprise after it.

## Later, deliberately not now

**Out to Base in the same signature.** Outbound CCTP from Starknet exists -
`deposit_for_burn_with_hook` on `TokenMessengerMinter`, checked against the
deployed ABI in [funded-onboarding.md](funded-onboarding.md). The claim intent
could burn the USDC to Base in the same relayed transaction, so the recipient
signs once in MetaMask and receives USDC on Base without ever touching Starknet.
One to two days plus a real cross-chain test with real money.

**One signature instead of two.** Verifying the EIP-712 claim inside the escrow
with secp256k1 and keccak from corelib removes the deploy and the ownership
signature entirely. It is roughly a hundred lines of Cairo - and it is new
cryptography in a contract holding funds, which is the one thing this design
currently avoids. Worth doing as polish, never as the first version.
