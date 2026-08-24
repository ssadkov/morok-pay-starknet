# MorokPay First 10 Donation Contest

Status: Donation UI is shipped. Dry-run the full ten-entry allocation and
payment loop before announcing the campaign.

## Offer

The first ten valid Donation QR entries all receive private USDC. Nobody in
the accepted ten loses. The fixed campaign budget is exactly 30 USDC:

| Recipients | Reward each | Subtotal |
| ---: | ---: | ---: |
| 1 | 10 USDC | 10 USDC |
| 2 | 3 USDC | 6 USDC |
| 7 | 2 USDC | 14 USDC |
| **10** |  | **30 USDC** |

The future finalized Starknet block hash does not select winners. It only
assigns the reward tiers among the first ten eligible Ready addresses.

## Eligibility

1. Open MorokPay on Starknet mainnet.
2. Connect Ready and activate STRK20 by shielding once.
3. Create a Donation QR (amount empty) and submit its absolute link before the
   campaign closes.
4. One registered Ready address counts once. The app verifies pool registration
   through `get_public_key`; social rules still handle duplicate people and bots.

The frozen entry set must contain current `kind=donation` links. Legacy
`kind=drop` links are not eligible.

QR creation and receiving a transfer do not charge the participant. A new user
does pay the pool fee when they first shield to activate STRK20. Campaign copy
must disclose that cost instead of calling entry free.

## Allocation

Freeze the ten links in `entries.txt`, publish the file/list hash before the
announced randomness block, then run:

```bash
node scripts/allocate-first-10.mjs entries.txt 0xFINALIZED_BLOCK_HASH
```

The script canonicalizes the address set, ranks every entry with SHA-256, then
assigns `[10, 3, 3, 2, 2, 2, 2, 2, 2, 2]`. Publish the seed, list hash,
algorithm, and allocation result before sending payments.

## Execution boundary

The current app pays one QR at a time. Do not budget as if batch payout already
reduces the pool fee; that must first be demonstrated on Sepolia. For every
payment, the organizer enters the allocated amount after opening the donation
link. The public allocation is auditable, while the normal STRK20 transfer does
not publish its recipient and amount as a MorokPay receipt.

Do not route contest payouts through DonationPot. The contest is the private
rail (hidden amount). The pot is a later, optional public-total rail.
