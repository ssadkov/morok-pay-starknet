# Who pays, and how much

Every cost in MorokPay is either the user's or ours, and the split is not
obvious from any one file — it is spread across the relay client, the deploy
route, the paymaster and the pool. This is the answer in one place, so it stops
being re-derived.

Figures are mainnet measurements unless marked otherwise, priced at
**$0.0263/STRK** (AVNU, both directions, 2026-08-31). Repricing is the first
thing to do before quoting any dollar figure here.

Two costs get confused constantly, so they are separate columns throughout:

- **pool fee** — a flat **6 STRK**, published by the pool itself
  (`get_fee_amount()`, re-read on mainnet 2026-09-03). Not ours, not
  negotiable, charged per `apply_actions` call.
- **gas** — what Starknet charges to include the transaction. On this rail it
  is the larger and far more variable half, because the account validates an
  EIP-712 signature in Cairo on every call and a private action carries a
  ~309k-felt proof whose verification is what is being paid for.

## The table

| Step | Gas | Pool fee | Cost | ≈ USD |
| --- | --- | --- | ---: | ---: |
| Bridge: approve + burn on Base | **user** | — | ETH on Base | — |
| Circle's transfer fee | — | — | 10 bps of the amount, 1¢ floor | 1¢+ |
| Deliver (mint) on Starknet | **MorokPay** | — | ~1 STRK | 3¢ |
| Create the Starknet account | **MorokPay** | — | ~1 STRK | 3¢ |
| Buy STRK with USDC | **AVNU** | — | ≤0.35 USDC, from the swap | ≤35¢ |
| Activate privacy (register) | **user** | **user** | 8.68–10.72 STRK | 23–28¢ |
| Shield 1 USDC | **user** | **user** | 11.31 STRK | 30¢ |
| Donate — first time to a recipient | **MorokPay** | **MorokPay** | ~9 STRK | 24¢ |
| Donate — again to the same recipient | **user** | **user** | ~9 STRK | 24¢ |
| Receive account `B`: deploy + register | **MorokPay** | **MorokPay** | ~10 STRK | 26¢ |
| Sweep `B` → main account | **MorokPay** | **MorokPay** | ~9 STRK | 24¢ |
| Unshield 1 USDC | **user** | **user** | 10.41 STRK | 27¢ |
| Public send (e.g. to an exchange) | **user** | — | 1.33 STRK | 3.5¢ |

A full round trip — activate, shield, send privately, unshield, send to an
exchange — measured **23.05 STRK, about 61 cents**, none of it sponsored.

**Receiving a donation costs the creator nothing.** The sender pays, and the
first transfer is on us.

## The four things that are not obvious

**Relaying costs us the pool fee too, not just gas.** A relayed donation is
~6 STRK of fee plus ~3 of gas. That is why a seven-payout contest budgets 63
STRK rather than a few cents of gas.

**Whether a donation is relayed is measured, not predicted.**
`namesRecipient` ([relay-client.ts](../lib/privacy/relay-client.ts)) looks in
the assembled calldata for the recipient's address. Present means this call
opens the channel and publishes who is being paid, so MorokPay submits it.
Absent means there is nothing to hide and no reason to spend our money, so the
donor submits their own proof. The question is never "is this their first
donation" — it is "does *this* transaction leak the link".

**The sweep `B` → main account is relayed unconditionally.** Not by the rule
above: `B` is never funded, so it can never pay its own fee under any
circumstances.

**The gasless swap is not sponsored by us.** AVNU submits it and takes its
cost out of the same USDC the swap is spending. Our money is not involved. The
two come from one balance, which is why
[onboarding-limits.ts](../lib/privacy/onboarding-limits.ts) requires enough
for both.

## Why the funding floor is 15 STRK when activation costs 11

Four registrations spanned **2.68–4.72 STRK of gas** — a 76% swing on the same
operation — putting the total between 8.68 and 10.72. So 11 is roughly the
average bill and a coin flip as a threshold.

The four STRK above it are deliberately bought headroom. The failure being
paid for is a specific one: telling somebody 11 was enough, taking their
money, and having them run out at the top of the observed range with a
half-finished account. `ONBOARDING_MIN_STRK` is that floor, and the onboarding
screen and the deploy route both read it — they once held 11 and 15
separately, which meant funding an address by hand with 12 satisfied the
screen and was then refused by the server.

For a creator who only *receives*, activation is not the whole obligation:
they never shield, because the donation arrives already private, but they
still pay to get it out. Unshield plus a public send measured 10.41 + 1.33.
Hence the honest pair: **~11 STRK to activate, ~23 to also withdraw**, quoted
in the UI as 15 and 25.

## What could change these numbers

**Batching.** Several actions in one `apply_actions` share a single proof and
a single pool fee. Four separate payouts cost ~36 STRK; batched they would be
one 6 STRK fee plus the gas for one larger proof. Never demonstrated here —
do not budget as if it works.

**Nothing else, from this app.** Gas is dominated by proof verification, and
that is not tunable from the client.

## Our exposure

The relayer is our wallet, and it is bounded rather than trusted:

- a **balance floor** — it refuses to submit when it holds less than one
  submission can cost ([relay-submission.ts](../lib/privacy/relay-submission.ts));
- **rate limits** — 20 submissions per caller per hour, 60 overall
  ([relay-limits.ts](../lib/privacy/relay-limits.ts)). The counters live in
  process memory, so on serverless they are per-instance: a brake, not a lock.

When either bites, the step fails with an error. It never silently moves the
bill to the user.
