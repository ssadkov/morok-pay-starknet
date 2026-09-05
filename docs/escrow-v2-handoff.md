# MorokEscrowV2: state, and what is left

Branch: `feat/escrow-v2`. Written 2026-09-05 for someone picking this up
without the conversation that produced it. The design and its reasoning are in
[evm-escrow-invoices.md](evm-escrow-invoices.md); this is the working state and
the queue.

## Where this is going, in four sentences

Somebody with an ordinary EVM wallet should be able to receive private USDC
without owning a Starknet wallet, without holding STRK, and without paying
anything. A sender parks money in an escrow contract; whoever the entry names
as owner takes it out. That owner is always an EVM-derived Starknet account -
their own if the sender knew their address, or one derived from the link's own
key if the sender only had a link to send. MorokPay pays for the claimer's
account and their transaction, because the money is already parked and this is
what delivering it costs.

## What is already true

**On mainnet, with V1 and real money.** A stranger with an empty MetaMask
collected 1 USDC and paid nothing: claim `0x2f716fbf...346997`, the claimer
registered in the pool by that same transaction, 9.56 STRK (~$0.26) of
MorokPay's for the account deploy and the claim together. That flow is on
`master` and works today. Do not break it.

**V2 is deployed to Sepolia and its rules are verified.**

| | |
| --- | --- |
| address | `0x0156be9d273accc356b928a5ad56341f90fff7f7a671786f1cf4289b42e9d382` |
| class | `0x131eebc15ce04224efd6f8dd6a06d935d8379d343447a9cebf457d4b6da94e4` |
| minimums | 1.000000 USDC, 5 STRK - read back from the chain |
| mainnet | deliberately not deployed; `escrowV2: ""` in `lib/starknet/constants.ts` |

`scripts/escrow-v2-probe.mjs --submit` passes **12 of 12** against it, twice,
on real entries: ownership, the opt-in index, a stranger's claim refused, a
refund before expiry refused, the claim paying a named destination rather than
the caller, double-claim refused, expiry refused, refund after expiry paid.
Re-run it after any contract change.

**The app's V2 foundation is written** (commit `ba6ebc3`): link format and its
tests, entry/index/minimum reads, deposit and claim/refund call builders, the
ephemeral-claimer signer, and `/api/escrow/claim`. 185 tests pass, typecheck
and production build are clean.

## What is left

In order. Each step is useful on its own.

### 1. `/stash` creates V2 entries

`components/pay/stash-panel.tsx` still calls `depositToEscrow` (V1). Switch it
to `depositToEscrowV2` in `lib/starknet/actions.ts`. The panel has to:

- generate a seed with `randomSeed()` from `lib/pay/escrow-v2.ts`;
- derive the owner: `ephemeralEvmAddress(seed)` gives the EVM address, and the
  factory's `get_expected_account_address` gives the Starknet one - use
  `inspectEth712Account(evmAddress, reader, factory)` from
  `lib/privacy/eth712-account.ts`, which returns `starknetAddress` whether or
  not it is deployed;
- set `refundOwner` to the sender's own Starknet address;
- set `expiresAt`, and **not** zero - see the open question below;
- leave `indexed` **false**. A link carries its own seed, so nothing needs to
  publish the owner. Read the index rule below before ever passing `true`.

Then build the URL with `claimV2Url`.

### 2. `/claim` redeems V2 links

`components/pay/claim-panel.tsx` parses V1's `?s=`. It needs to try
`parseClaimV2Request` (`?k=`) first and fall back to V1, because mainnet links
already exist in the wild and must keep working.

The V2 path is much shorter than V1's:

1. read the entry with `readEscrowV2Entry`, and decide what to show with
   `escrowV2Status` - do not re-derive the expiry boundary in the component;
2. the claimer connects their own wallet; their Starknet address is the
   `destination`;
3. sign with `signEphemeralClaim` from `lib/privacy/ephemeral-claimer.ts`,
   passing `escrowV2ClaimCall(...)` as the call and the relayer as `caller`;
4. POST to `/api/escrow/claim` with `{ network, commitment, calldata,
   evmAddress, signature }` - the last two being the link's own address and
   its `signEphemeralOwnership` signature, for the deploy.

The claimer signs **in the browser with the link's key**, not in MetaMask:
their own wallet is only the destination. That is why this claim needs no pool
fee, no proof and no registration, and why it should cost a fraction of V1's
$0.26. Measure it and put the number in `docs/who-pays.md`.

### 3. A refund screen

Does not exist. An expiry without a way to act on it is worse than no expiry,
because the sender believes they are protected. The sender needs a list of
what they parked, which is browser-local today
(`recordActivity` in `lib/pay/activity.ts`), and a button calling
`escrowV2RefundCall`. The sender pays their own gas here - they have STRK, they
are the one who parked.

### 4. Then, and only then, mainnet

Deploy with `node scripts/deploy-contract.mjs escrowV2 mainnet` - it refuses to
move without `--submit` and prints the class hash, constructor, estimated fee
and the balance it would come from. Fill in `escrowV2` for MAINNET in
`lib/starknet/constants.ts`. V1's mainnet contract stays where it is; it holds
nothing and has no upgrade path, so V2 is a new address, not a migration.

## Rules that cost real money to learn

Do not rediscover these.

**A claim's destination must be inside the signature.** V1 put a secret in
calldata and let the submitter choose where the money went, so relaying meant
trusting the relayer. The whole V2 design exists to fix that. Never add a claim
path where the destination is a free parameter of the submitter.

**`indexed` is not a convenience.** It publishes the owner, so anyone can ask
"does this address have money waiting, and how much" about anyone. Set it only
for an invoice to an address, where there is no link and discovery is otherwise
impossible. Default false, always.

**A fresh Starknet account is invisible to the proving block.** Proofs are
built against `latest - 10`, so an account deployed a moment ago cannot be
proven over. This bites V1's private claim, not V2's public one - but if you
touch anything pool-shaped, deploy at invoice-creation time, not at claim time.

**A pool action set that spends no note is refused** with
`NO_REPLAY_PROTECTION`. A deposit funding a withdrawal in the same set still
has to consume one note. `spendPlan`/`selectSpendNotes` in
`lib/privacy/evm-strk20-account.ts` encode this; the error message for an
account with no private balance at all is deliberate.

**A fresh account needs two setups**, a channel and a per-token subchannel, or
the pool answers `SUBCHANNEL_NOT_FOUND`.

**`MOROKPAY_MAINNET_RELAY_ENABLED=true` must be set on Vercel**, unlike
Sepolia where relaying is on by default. Without it the deploy works and the
claim fails, which reads as a bug in the wrong place.

**`?k=` is V2, `?s=` is V1.** They authorise differently and live in different
contracts. A V1 secret read as a V2 seed computes an entry that does not exist,
silently.

## Open question, for the product owner

**What expiry does the app offer?** The contract accepts zero, meaning never
expires and never refundable. That is expressible on purpose and should not be
the default a UI hands out - a link nobody claims would be money nobody can
reach, forever. 7 days? 30? Ask before shipping step 1.

## How to check your work

```bash
npx tsc --noEmit && npx vitest run && npm run build
node scripts/escrow-v2-probe.mjs                 # read-only
node scripts/escrow-v2-probe.mjs --submit        # 12 checks, spends Sepolia STRK
```

The probe needs `spare` to hold shielded STRK; it shields for itself if short.
Sepolia STRK comes from the deployer via
`node scripts/transfer-strk.mjs deployer <address> <amount> sepolia`.
