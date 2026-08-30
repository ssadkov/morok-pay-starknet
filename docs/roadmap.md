# Roadmap

What is not built, why, and how big each piece actually is. Sized honestly:
everything marked *weeks* is a service with keys and failure modes, not a
feature.

Shipped work is described in [the README](../README.md); what was measured on
mainnet rather than assumed is in [handoff.md](handoff.md).

## 1. Arrive with USDC, never buy STRK by hand

**The problem.** Someone holding USDC on Base and no Starknet wallet cannot
reach a private balance without first acquiring STRK, because every step after
the bridge costs gas in STRK and the pool charges its fee in STRK on top. Today
the app refuses mainnet onboarding below 15 STRK and tells them to send it
themselves - which asks a person who wanted to donate USDC to go buy an
unrelated token on an exchange they may not use. It is the largest single
drop-off in the EVM path.

**What is already there.** CCTP V2 is wired end to end: `depositForBurn` on
Base, Circle's attestation, `receiveMessage` on Starknet (`lib/cctp/`). The
burn and the mint both work. The mint is executed by the user's own Starknet
account, which is exactly where the STRK requirement bites.

**The constraint that shapes the design.** The account class supports SNIP-9
outside execution, so a relayer can submit calls and pay their gas while the
user only signs an EIP-712 intent. But `OutsideExecution` has no proof field,
and STRK20 passes its proof as a transaction-level extension rather than in
calldata. **A shield cannot be relayed**, and no amount of paymaster work
changes that. So one atomic bridge-and-shield is out; shielding without ever
having bought STRK by hand is in, by splitting at the proof boundary:

```
Base                    Starknet (relayer pays gas)         Starknet (user pays)
burn USDC   ──────────► receiveMessage  (mint USDC)
                        swap USDC → STRK via AVNU
                        service fee to MorokPay
                                                     ─────►  shield USDC
```

The middle block is one batch of ordinary public calls, all relayable, inside a
single intent signed once. It leaves STRK in the account, and that STRK pays
for the shield.

**Circle's hooks do not execute on Starknet, and are not needed.** Checked
against the deployed ABIs: inbound, `TokenMessengerMinter` only exposes
`handle_receive_finalized_message`, which mints and dispatches nothing, and
`MessageTransmitter` only exposes `receive_message`. What is there instead are
the two knobs that matter - `mint_recipient` can be a helper contract of ours,
and `destination_caller` can be our relayer, both fixed at burn time on Base.
The relayer then submits one transaction that receives the message into the
helper and settles it: swap a slice through AVNU, forward STRK and USDC to the
user, take the fee. Atomic, so a swap that reverts on slippage reverts the mint
with it and the attestation stays replayable.

**Size: weeks.** It is a relayer service - key custody, nonce management, rate
limiting, abuse handling - plus an AVNU integration, fee accounting and refund
paths. The full research and the open questions are in
[funded-onboarding.md](funded-onboarding.md); the one that has to be answered
before it ships rather than after is the legal shape, because taking a cut of a
cross-chain transfer is money-transmission-shaped.

## 2. Anonymous receive account on Ready X

On the MetaMask rail a donation QR publishes a separate receive account that
the relayer deploys and registers, so the creator's main account is never
linked to it. On Ready X the QR still publishes the wallet's own address.

The signature this depends on has been checked on a real Ready X wallet and is
reproducible, and the deploy, register and sweep functions already exist for
the other rail. **Size: days.** It is wiring, not new design.

## 3. Batched payouts

Every private transfer today is its own transaction: its own proof, its own gas
and its own pool fee. Several actions can share one `apply_actions`, and the
SDK exposes a multi-op batch, which would cut both the fee and the gas for
anyone paying more than one recipient at a time - an organizer paying out a
campaign, or a creator distributing to collaborators.

Never demonstrated here, so nothing is budgeted as if it works.
**Size: days to prove on Sepolia**, after which it is a measurement rather than
a promise.

## 4. Fee at the unshield

MorokPay's own fee belongs at the in-app unshield - the public edge - and not
inside every private donation, so a donation reaches its creator whole. The
reasoning is in [fees.md](fees.md). Funded onboarding above would add a second
fee at the entry edge; the two sit at opposite ends deliberately and never
stack on the same transfer.

## 5. Production hardening

The relay's rate limit is in-memory and per-process, which on serverless means
it resets per instance. Fine while the organizer is the only caller, wrong for
open traffic. Known and written down rather than discovered later.

## 6. Private BTC

`lib/starknet/tokens.ts` already carries mainnet `strkBTC` alongside USDC and
amount parsing is decimals-aware, but the donation request format is USDC-only.
**Size: days**, mostly link format and UI copy.

## 7. DonationPot

A public-total rail - a visible campaign thermometer - alongside the private
one, for creators who want the total known and the donors not. Design-only; see
[donation-pot.md](donation-pot.md).
