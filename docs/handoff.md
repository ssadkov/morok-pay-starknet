# Handoff

MorokPay is a private donation product on Starknet. This handoff picks up
right where the previous chat stopped. The previous session's "Open next"
question is answered - see "Answered 2026-08-30" - so start at "Also open".

## Done (2026-08-29 session, PRs #7-15, merged to `master` at `a62fcd0`)

Both privacy requirements from
[private-donation-requirements.md](private-donation-requirements.md) are now
shipped and verified on-chain, not just read from source:

- **Donor never publicly linked to a QR.** `/api/privacy/relay`
  ([lib/privacy/relay-submission.ts](../lib/privacy/relay-submission.ts))
  submits a donor's proven first transfer from MorokPay's own relayer instead
  of the donor. Works on both wallet rails - the EVM-derived account relays
  through the SDK directly
  ([lib/privacy/evm-strk20-account.ts](../lib/privacy/evm-strk20-account.ts));
  Ready X hands over a proven call via `wallet_strk20PrepareInvoke` and the
  donor's own `executeWithProof` submits it when relaying isn't needed
  ([lib/starknet/actions.ts](../lib/starknet/actions.ts)). The decision to
  relay is read off the assembled call itself (does it name the recipient),
  not predicted from wallet state -
  [lib/privacy/relay-client.ts](../lib/privacy/relay-client.ts)'s
  `namesRecipient`.
- **Creator's real address never on the QR.** A separate receive account `B`
  ([lib/privacy/receive-account.ts](../lib/privacy/receive-account.ts))
  derives deterministically from one MetaMask signature, gets deployed and
  registered by the relayer so the creator's main account never pays for it,
  and My QR publishes `B`. The sweep `B -> A` relays unconditionally, since
  `B` is never funded and so can never pay its own fee.
- Ready X's own anonymous-`B` path is **checked, not assumed** - a standalone
  card on My QR asks Ready X to sign the same message twice and compares the
  results before anything deploys. Passed on a real Ready X wallet
  (`0x182f8f9a...2562b039c` derived from `0x00e5887f...8498423`, see below);
  wiring Ready X into the actual deploy/register flow is not done yet.
- Verified on Sepolia with real transactions, reproducible:
  [scripts/relay-probe.mjs](../scripts/relay-probe.mjs),
  [scripts/receive-account-probe.mjs](../scripts/receive-account-probe.mjs),
  [scripts/unrelayed-demo.mjs](../scripts/unrelayed-demo.mjs) (the "before"
  case - a donor submitting its own first transfer, deliberately not
  relayed, tx `0x5ad40cbb...` on Sepolia: sender is the donor's own address,
  recipient sits in plaintext calldata).
- Verified on **mainnet** with real donated money, tx by tx:
  - `0x6bf4c95c...` - Bemused Bee's Enable Private: registration **bundles a
    6 STRK shield in the same transaction**, gas sponsored by a Ready X
    paymaster.
  - `0x72a1ff15861611e7d307c67a77dd817603136c818853fd606fbf9660ee05708` -
    a real mainnet donation to Bemused Bee's real address (not yet `B` - see
    below), relayed by MorokPay: sender is MorokPay's relayer
    `0x34d43acc...`, donor absent from calldata and events, and the
    recipient's address is the one thing the calldata does name. Re-measured
    2026-08-30; this is the mainnet ground truth for what a Ready X-built
    transfer publishes.
  - `0x49199f62...` - Bemused Bee's unshield: **fully paymaster-sponsored**
    (pool fee + gas both paid by Ready X's own infrastructure), which takes
    its own ~15-18% cut directly out of the withdrawn USDC instead of
    charging public STRK.
  - `0x713ffeeb...` - the *other* known wallet's (`0x00e5887f...8498423`,
    documented below as the sprint submission wallet) own Enable Private,
    same bundled-shield pattern, different Ready X paymaster address
    (`0x4455355f...`). Confirms the pattern generalizes, not a one-wallet
    fluke.
- UI: mainnet is the default network now (`lib/network.ts`); My QR and
  Donate no longer scroll unnecessarily; "Top up" is hidden from the header
  nav on mainnet (it's the Base-bridge/testnet-faucet page); "Ready" renamed
  to "Ready X" everywhere (102 replacements, 28 files); a wallet-detection
  race in `watchWallets()` that caused "Ready X sometimes isn't found, reload
  fixes it" now retries; the deploy-shortcut button is honestly labeled
  ("Send 0.01 STRK to MorokPay", not "Activate for 0.01 STRK" - it's an
  ordinary transfer to our treasury, not the cost of activation, and the
  free alternative - Ready X's own Activate-account prompt - is named next
  to it); a loaded donation link can be copied, and a paste button was added
  to the link field; the verified funding numbers are in the UI copy
  (~6 STRK to Enable Private, unshield fees come out of the withdrawal
  itself for Ready X).
- `scripts/allocate-contest.mjs` replaces `allocate-first-10.mjs` for the
  live campaign: caps entries at 7, splits a $20 budget by rank
  `[6,4,3,3,2,1,1]`, rescaled (largest-remainder rounding) to however many
  people actually finish - fewer finishers means each gets more, never a
  guessed headcount left unspent.

## Measured 2026-08-30: what a private transfer publishes, and what is still open

The previous session's open question - does Ready X's own paymaster sponsor
ordinary private transfers, or only its first-party flows - is **still open**.
What did get settled is a different and narrower thing: which addresses a
private transfer writes into public calldata. Keep the two apart; an earlier
draft of this section ran them together and overclaimed.

Measured with [scripts/calldata-leak-probe.mjs](../scripts/calldata-leak-probe.mjs),
which takes every felt in a transaction's `__execute__` calldata that could be
an address and asks the pool `get_public_key` about it. A nonzero answer means
that felt is a registered STRK20 account lying in public calldata, not a proof
word that happens to look like an address.

**Ground truth, mainnet, both sides known.** Our own relayed donation
`0x72a1ff15861611e7d307c67a77dd817603136c818853fd606fbf9660ee05708`
(donor: the sprint wallet `0x00e5887f...`; recipient: Bemused Bee
`0x0367903f...`; submitted by the relayer `0x34d43acc...`):

- transaction sender is the relayer - the donor is nowhere in the envelope;
- calldata names **exactly one** registered address, `0x0367903f...` - the
  **recipient**;
- the donor's address is absent from the calldata entirely.

So on the Ready X rail a channel-opening transfer publishes *who is paid*,
never *who paid*.

**Ground truth, Sepolia, EVM rail.** `unrelayed-demo.mjs`'s transaction
`0x5ad40cbb69bde37be33367445a973b446644e4e227ce4ea8623410b1cab5807`
(sender `0x9294eb78...` = `spare`, recipient `0x1f7c1a12...` = the throwaway)
names **both** addresses in calldata, and the donor is the transaction sender
too. The SDK-built action set embeds the sender; the Ready X-built one does
not. That difference is why the two rails need different treatment, and it is
measured, not assumed.

**The other sprint projects.** Of the 25 verified mainnet transactions in the
hub's `hackathon-projects.json`, 8 projects have any; 7 of them show the
confirmed Ready X signature above - exactly one registered address in
calldata, never the transaction sender, constant across that project's
transactions (philoxenia `0x04912f27...`, Morrow `0x04598aca...`, Airlock
`0x03be3741...`, Aperture `0x065ef5b1...`, Cutout two addresses, Redpocket
`0x02cf3864...`). Every one of their senders is a fresh account with class
hash `0x1a736d6e...` - **the same class as the documented Ready X paymaster
`0x4455355f...`**, and none registered in the pool, so none is a user wallet.
The exception is offbook, which submits `apply_actions` from its own
registered account `0x018e8c72...` and publishes its sender outright.

**This does not show that Ready X sponsors plain transfers.** A self-shield
is a self-channel and names exactly one address too, so the seven cannot be
told apart from shields without decoding the router's action list, which was
not done. Every transaction we *know* to be paymaster-submitted is a
first-party flow: our own register+shield (`0x713ffeeb...`, `0x6bf4c95c...`)
and unshield (`0x49199f62...`). No mainnet transaction is known to be a plain
Ready X transfer to a third party submitted by Ready X's own paymaster.

**What is settled.** The donor's address is not in the calldata of a Ready
X-built transfer, whoever submits it - that half of donor privacy costs
nothing and is not what our relay provides. What the relay decides is the
transaction's `sender_address`, and only on the one transaction that opens a
channel: `transferPrivate` in [lib/starknet/actions.ts](../lib/starknet/actions.ts)
relays only when `namesRecipient` is true, and otherwise has the donor submit
its own `executeWithProof`. Every later donation to the same creator is
already unrelayed today.

**Still open, and it decides whether the relay earns its cost on Ready X.**
Does Ready X put a plain first transfer through its paymaster, or through the
donor's own account? The test from the previous handoff still stands and is
about twenty minutes: from Ready X's own send UI, outside MorokPay entirely,
make a first private transfer to a freshly registered address, then read that
transaction's `sender_address`. If Ready X sponsors it, relaying on this rail
buys nothing and costs ~9 STRK per first donation. If it does not, the relay
is the only thing keeping the donor out of the envelope. On the EVM rail the
question does not arise - there is no paymaster, our three EVM transactions
are self-submitted with the sender in the open, and the relay is mandatory.

Either way, receive account `B` remains the only mechanism here that keeps the
*creator's* address out of that calldata, and that is the half worth leading
the messaging with.

## Field note 2026-08-30: what Enable Private costs a real user, and how it fails

First outside user onboarded, wallet
`0x03b93860b4c7809e565ccb3f382fbe00ed1d6d6fa4b5cfe49ae0b93ce42df9ab`
(ordinary Ready X account, class `0x36078334...` - the same class as the
sprint wallet and Bemused Bee).

**Cost, measured on the successful transaction**
`0x6969c1dd100d1dbc81a0e671df61590f9a07c922617ccf3d89b5a3d123d355e`:

- the user's own wallet pays **exactly 6.0000 STRK** to the pool;
- gas was **3.0895 STRK, paid by a Ready X paymaster**, not by the user;
- a paymaster also fronts its own 6 STRK through the router.

Two independent wallets now agree on the 6 STRK figure, so the campaign copy's
"~6 STRK, charged by the STRK20 pool" is right and does not need raising.

**The failure and what actually fixed it.** Ready X refused with "Failed to
prepare the privacy transaction. Please try again" while the wallet held
9.81 STRK. The obvious reading was that 9.81 could not cover the fee plus gas
if the paymaster declined - that reading is **wrong**, and worth recording as
wrong: the successful transaction needed only 6 STRK from the user, which they
already had. The user removed the Ready X extension and installed it again,
and it went through. A 17 STRK top-up arrived shortly before the retry and
muddies the story, but it did not change what the transaction required.

So the remedy to give anyone who hits that message is **reinstall the
extension**, not "add more STRK". It is in the contest copy on that basis.

**Fourth paymaster.** `0x010eb4fb...` submitted it, class `0x1a736d6e...` -
the same class as the three already known. Sponsoring Enable Private is a pool
of sponsor accounts, not a courtesy extended to one wallet.

## Also open

0. **Screenshot onboarding copy** - `docs/assets/ready-onboarding/` has seven
   real Ready X screenshots from this session (connect, deploy, the actual
   "Activate account" native flow, Enable Private tokens, the insufficient-
   funds state). Saved because prose instructions for someone else's UI are
   the weakest part of the current onboarding steps on My QR - swapping them
   for these screenshots (or an English-relabeled version, which the user
   said they'd make) was recommended but not done.
1. **X post copy** - drafted, not finalized. Needs the user's voice pass,
   a real link (not vercel.app if a custom domain exists), and a decision on
   whether to reference the crypto_rentier channel. A promotional image was
   offered, not made - no `brand.md` exists in this repo to derive colors
   from.
2. **Contest terms** - `docs/private-first-10.md` still describes the old
   10-entrant/$30 campaign. `scripts/allocate-contest.mjs` implements the new
   7-cap/$20 mechanic but there is no written terms doc for it yet - needed
   before announcing publicly (eligibility, what "finishing" means, when the
   randomness seed gets published, etc., same shape as the old doc).
3. **Mainnet relayer funding** - `0x34d43acc...` (role `relayer` in
   `.secrets/mainnet-accounts.json`) held 34.93 STRK after the last check.
   One relayed first-donation costs ~9 STRK on mainnet (6 STRK pool fee +
   ~3 STRK gas, both measured). Refill before running the contest for real -
   7 finishers' first donations could be ~63 STRK if MorokPay is also the
   one donating the prizes (each is a first-time channel to a new QR).
4. **Rate limit is in-memory, per-process.** `RELAY_PER_CALLER` was raised
   5->20/hour after it blocked the organizer's own contest payout run from
   one browser. On Vercel this resets per serverless instance, which is fine
   for now (nobody but the organizer hits it) but is not a real production
   rate limit - noted as pre-existing tech debt before, still true.
5. **Ready X anonymous `B` is checked-working but not built.** The
   determinism check passed; deploy/register/sweep for a Ready X-derived `B`
   reuses the exact same functions the MetaMask rail already has
   (`deriveReceiveAccount`, `receiveAccountDeployCall`, the relay endpoints) -
   it's a wiring task, not new design, once wanted.
6. **A real mainnet example of the unrelayed case does not exist yet**
   (see "Open next" above) - if the answer turns out to be "no, Ready X does
   not sponsor plain transfers," it would be worth deliberately producing one
   real mainnet example the same way `unrelayed-demo.mjs` did on Sepolia,
   for the same reason: something to point at, not just cite from source.

## Product flow

- `/` - choose Donate or My QR.
- `/pay` - open or paste a donation request (now with a paste button and a
  copy-link action), choose an amount, and pay privately. Shows a clear
  "this would be public" choice if the connected wallet can't confirm its
  signature is repeatable enough to relay safely.
- `/sell` - activate STRK20, optionally set up an anonymous receive account
  (MetaMask only, live; Ready X, checked-but-not-wired), and create one
  reusable open-amount Donation QR.
- `/treasury` - Base CCTP top-up, shield, private balances, and payout.
  Hidden from the mainnet header nav; still reachable by direct link.
- `/privacy-sdk-lab` - EVM onboarding and diagnostic operations, network-aware.
- `/claim` - compatibility route for previously issued `MorokEscrow` links.

## Technical boundary (unchanged from before, still true)

Ready X owns the viewing key, note discovery, proving, and submission for its
own users. Do not ask users for viewing keys. The EVM rail derives its
viewing key in browser memory only, from a MetaMask signature.

MorokPay's planned service fee still belongs at `Unshield`, not inside every
private donation - see [fees.md](fees.md). Ready X's own unshield already
takes a comparable cut (~15-18%, measured) for sponsoring the fee itself;
worth factoring into any MorokPay fee design so the two don't stack
unpleasantly.

## Reference: known accounts

- **Sprint submission wallet**, Ready X, mainnet:
  `0x00e5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423`.
  Registered at block 13451907. Also reused as the
  `NEXT_PUBLIC_MOROK_TREASURY_*_ADDRESS` placeholder in `.env.example` - it's
  the same address on purpose or by accident, not confirmed which.
- **"Bemused Bee"**, Ready X, mainnet, this session's live test wallet:
  `0x0367903fe74bfb767fd9602aec719f5c57987b870c81a1b7c8a2205707a2750e`.
- **Mainnet relayer**: `0x34d43acc20256972081101fe26be76bf4abbb4a191d7d4630e3fe527183c792`
  (role `relayer` in `.secrets/mainnet-accounts.json`). Matches
  `MOROKPAY_MAINNET_RELAYER_ADDRESS` by strong circumstantial evidence
  (balance moved exactly as expected across the session's donations); never
  independently confirmed by reading the Vercel secret itself.
- **Sepolia test roles** (`.secrets/sepolia-accounts.json`): `deployer`,
  `payout`, `spare` - all funded, registered, reusable by every script in
  `scripts/`.
- **Four** Ready X paymaster/infra addresses seen submitting on a user's
  behalf, never explained further: `0x57130b60...`, `0x22391d61...`,
  `0x4455355f...`, `0x010eb4fb...`. All four share class hash
  `0x1a736d6e...`, as do every paymaster seen submitting for the other sprint
  projects - so this is one sponsor system with many accounts, not several
  systems. Not investigated further.
- **First outside user**, Ready X, mainnet:
  `0x03b93860b4c7809e565ccb3f382fbe00ed1d6d6fa4b5cfe49ae0b93ce42df9ab`.
  Registered at block 14089135. See the 2026-08-30 field note.
