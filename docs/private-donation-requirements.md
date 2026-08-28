# Private donation requirements

Status: specification. The relayer is the first thing to build; the separate
receive address is second. Both are checked against the pool's Cairo source in
[docs/relayed-submission.md](relayed-submission.md).

## The two requirements, in priority order

1. **A donor must not be publicly linked to a QR.** Holding a private account
   and a shielded balance is not a disclosure - it says nothing about who
   anyone paid. What must never become public is that a specific person paid a
   specific published QR. The amount is hidden by the protocol either way.
2. **A published QR must not carry the creator's main address.**

Requirement 1 comes first. It protects the person with the least to gain from
the transaction, and it is the one this project can lose permanently in a
single transaction - once a link is on chain, no later change removes it.

## What is already private, with no help from us

- **The amount.** Always. A note's value is encrypted; `EncNoteCreated` carries
  only `packed_value`.
- **Who paid whom.** Notes and nullifiers are commitments. Nothing outside the
  pool ties them to an address.
- **Every repeat donation.** The second and all later donations from the same
  donor to the same creator emit only `EncNoteCreated` and `NoteUsed`. No
  address, no amount, nothing to correlate.

## The one gap: the first donation opens a channel

A channel exists per sender-recipient pair. Opening it is a public
`Append { recipient_addr, enc_channel_info }`, and in the current
implementation the donor submits that transaction themselves
(`lib/privacy/evm-strk20-account.ts:233`). Sender and recipient therefore
appear in the same public transaction. Only the amount stays hidden.

That single transaction is the whole of requirement 1. Everything after it is
already private.

## Relaying, and why it is first priority

`apply_actions` runs no caller check - authorization is the transaction's proof
facts - and `collect_fee` charges `get_caller_address()`. So MorokPay can
submit a donor's proven action set and pays the pool fee itself.

What that buys:

- The donor is not the sender. The first donation publishes `B` and nothing
  about who paid it.
- The donor never needs public STRK, so there is no funding trail to their
  address.

Cost: roughly `9 STRK` on mainnet (a `6 STRK` pool fee plus gas), **once per
donor-creator pair**. Every later donation from that donor to that creator is
free for us and fully private. Treat it as a one-time acquisition cost, not a
per-donation tax. Relaying the first donation is the minimum; relaying every
donation costs the same per transaction and buys nothing extra.

What relaying does **not** fix:

- A shield names the depositor: `TransferFrom.from_addr` is in the calldata
  whoever submits it. Relaying a shield is pointless.
- Registration publishes the registering address.
- `get_num_of_channels(recipient)` remains a public count of distinct senders.

What relaying **moves**: the correlation leaves the chain, where it is public
and permanent, and arrives at us, where it is private and transient. We see
timing, IP, and payload, and we can join "this browser opened a creator page"
to "this submission arrived two seconds later". That makes the guarantee a
property of our service rather than of the protocol. Do not run this without
deciding, and publishing, what the relayer logs and for how long.

## Requirement 2: the published receive address

The creator publishes `B`, not their main account `A`. `B`'s keys derive
deterministically from a signature by `A`, so there is no second seed to
manage, and the relayer registers `B` in the pool - which is why `B` never
needs a public STRK top-up from `A`, the one transaction that would tie them
together.

The sweep is an ordinary private transfer `B -> A`. It opens a channel to `A`,
so `A` appears in that calldata, but nothing in the same transaction names
`B`: it is spent through nullifiers. An observer sees that someone opened a
channel to `A`.

## What is never private

State these plainly wherever the product makes a privacy claim:

- Shield and unshield publish an address and an amount.
- Registration publishes an address.
- `get_num_of_channels` publishes a creator's distinct-donor count.
- **The proving service receives everything.** The invocation it proves is
  `compile_actions(user_address, viewing_key, client_actions)` - the user's
  address, their viewing key, the recipient and the amounts, in the clear.
  `ohttp: true` hides the client's IP, not the content.
- The auditor can decrypt a withdrawal's user address and an open note's owner
  (`packages/privacy/src/events.cairo`).
- Timing correlates. A public shield of `$50` at 12:00 followed by a channel
  opening at 12:01 invites the obvious inference. Advise shielding ahead of
  time and for more than the intended donation.

## Why DonationPot does not serve requirement 1

A donation into the pot is a withdrawal from the pool, so
`TransferTo { to_addr: pot, amount }` publishes the amount of every single
donation - the thing requirement 1 keeps hidden. And it needs relaying on
*every* donation rather than the first, because without a relayer the donor,
the amount, and the campaign land in one public transaction every time.

Its privacy is requirement 2 only, and it depends on the same relayer. The
public donor count that motivates it comes free from `get_num_of_channels`;
the pot adds the public total, at the price of every individual amount.

## Build order

1. A relayer endpoint that submits `apply_actions` and pays the pool fee. Use
   it at minimum for a donor's first donation to each creator.
2. `B` as the published receive address, registered through that relayer.
3. Privacy copy that matches the two lists above - what is hidden, and from
   whom.
