# MorokPay Private Donation Contest

Supersedes [private-first-10.md](private-first-10.md), which described the
earlier 10-entrant / $30 campaign. The mechanic here is the one
[scripts/allocate-contest.mjs](../scripts/allocate-contest.mjs) actually
implements: a fixed $20 budget, a cap of 7 entries, and a split by rank that
rescales to however many people finish.

## Dates

StarkWare extended the sprint by seven days on 2026-08-31 (announced in the
builders' Telegram group by Starkience | StarkWare): the new deadline is
**Monday 2026-09-07**. No hour was given, so every date below is set backwards
from 2026-09-07 **00:00 UTC** - the earliest reading, which is the only safe
one. Re-read the live countdown on <https://strk20.starknet.io/hackathon>
before the close and move the dates *later* if it turns out to be generous;
never plan against the generous reading.

**Drawing on 2026-09-01, not on the extended deadline.** Four entrants
published a QR, and the run is deliberately not held open to 09-05 for more.
The reasoning is that a settled contest is worth more than a larger one here:
the payouts are the mainnet evidence the sprint scores, the write-up is
content that only exists once the draw has happened, and holding the field
open spends the extension's whole gift on waiting rather than on the video and
the receive account. Four is a real field; the split rescales to it.

| When (UTC) | What |
| --- | --- |
| 2026-08-31 | Announcement posted, entries open |
| **2026-09-01** | **Entries close.** Entry list frozen, its hash published |
| 2026-09-01 | Seed published: the first Starknet mainnet block after the close |
| 2026-09-01 | Allocation published, all payouts sent |
| 2026-09-01 | Payout tx hashes recorded in `strk20.json`, result posted |
| 2026-09-07 00:00 | Sprint closes (earliest safe reading, hour not announced) |

Six spare days behind the payout run, where the original schedule had nine
hours. Each payout is a first-time donation to a QR nobody has paid before, so
each is a separate relayed transaction sent one at a time through the app (see
Cost, below).

## Offer

A fixed budget of **$20 in USDC**, split by rank among however many valid
entries arrive, capped at 7. `BASE_WEIGHTS = [6, 4, 3, 3, 2, 1, 1]` are
rescaled with largest-remainder rounding so the first K weights always sum to
exactly $20. Fewer finishers means larger prizes, never an unspent remainder:

| Finishers | Prizes |
| ---: | --- |
| 7 | $6, $4, $3, $3, $2, $1, $1 |
| 5 | $6.67, $4.45, $3.33, $3.33, $2.22 |
| **4** | **$7.50, $5.00, $3.75, $3.75** |
| 3 | $9.23, $6.15, $4.62 |
| 1 | $20 |

Nobody who finishes gets nothing. The block hash does not choose *whether*
someone is paid, only which rank they land on.

## Where the prize goes

Into the entrant's **private STRK20 balance** - the prize is paid to the
private account the donation QR publishes, as an ordinary private transfer.
The chain does not publish the amount, and the entrant is not linked to the
organizer's address by the transfer itself. It is not sent to a public
address, and there is no separate claim step; it appears as private balance
in the wallet that owns the QR.

## Eligibility

1. Open MorokPay on Starknet **mainnet**.
2. Connect Ready X, or MetaMask on the EVM rail (no Starknet wallet needed).
3. Activate STRK20 once. This costs the entrant the pool's own fee -
   ~6 STRK, charged by the STRK20 pool, not by MorokPay. **Campaign copy must
   say this. Entry is not free.**
4. Create a Donation QR with the amount left empty, and submit its absolute
   link before the close.
5. One registered address counts once. The app verifies pool registration
   through `get_public_key`; duplicate people and bots are handled socially.

Only current `kind=donation` links on `n=mainnet` with no `amount` parameter
are eligible - `parseDonationEntries` rejects everything else, including the
legacy `kind=drop` links.

## The address an entry publishes

An entry is a public link, and a donation link necessarily names the address
that receives. What that address is depends on the rail, and the difference is
real today:

- **MetaMask rail (live).** The QR publishes receive account `B`, derived and
  deployed for this purpose. The entrant's main account is never on the link.
- **Ready X rail.** `B` is checked-working but not wired
  (see [handoff.md](handoff.md)), so a Ready X QR publishes the entrant's
  **real Ready X address**.

So the announcement must tell Ready X entrants to use an address they do not
mind posting. Saying "your QR does not publish your wallet" would be false on
the rail most entrants will use.

## Allocation

Freeze the entries in `entries.txt` at the close and publish the file's hash
before the seed block exists. Then:

```bash
node scripts/allocate-contest.mjs entries.txt 0xSEED_BLOCK_HASH
```

The seed is the hash of the first Starknet mainnet block produced after the
close. Accepted-on-L2 is enough - waiting for L1 finality would push the
payouts past the sprint deadline, and the seed's only job is to be a number
nobody could know while entering.

The script canonicalizes the address set, ranks each entry by
`sha256(seed + "\n" + listHash + "\n" + address)`, and assigns the rescaled
weights. Publish the seed, the list hash, the algorithm and the result before
sending anything. An entrant who knows their own address can recompute their
own rank without the organizer publishing anybody else's.

## Cost to run it

Measured on mainnet, per payout: **~6 STRK pool fee + ~3 STRK gas ≈ 9 STRK**,
because every payout opens a new channel to a QR that has never been paid.
Four payouts is **~36 STRK**.

The relayer `0x34d43acc...` held **34.93 STRK** at 2026-08-30 00:15 UTC+5, and
has paid for deployments and bridge deliveries during testing since, so the
figure now is lower. **Re-read the balance and refill before the draw** - 36
STRK is more than it held even before that spending, so a field of four cannot
be paid out of it as it stands.

Batching several payouts into one `apply_actions` would cut the pool fee
dramatically, but it has never been demonstrated on Sepolia, and the app pays
one QR at a time. Do not budget as if batching works. The extension makes it
worth *trying* on Sepolia before the close - 63 STRK of pool fee to move $20
is the single worst number in this document - but the budget above stands
until a Sepolia transaction says otherwise.

## Execution boundary

For each payout the organizer opens the entrant's donation link and enters the
allocated amount by hand. The public allocation stays auditable; the transfer
itself does not publish its recipient or amount.

Do not route contest payouts through DonationPot. The contest is the private
rail. The pot is a later, optional public-total rail.
