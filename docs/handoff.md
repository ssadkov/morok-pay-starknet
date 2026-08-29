# Handoff

MorokPay is a private donation product on Starknet. This handoff picks up
right where the previous chat stopped - read the "Open next" section first,
it names the one thing worth checking before anything else.

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
  - `0x72a1ff15...` - a real mainnet donation to Bemused Bee's real address
    (not yet `B` - see below), relayed by MorokPay: sender is MorokPay's
    relayer `0x34d43acc...`, donor absent from calldata and events.
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

## Open next - check this first

**Does Ready X's own infrastructure already relay plain private transfers,
the same way it relays registration, shield, and unshield?**

Every mainnet transaction examined this session where a *real* Ready X
wallet did something pool-related - `0x6bf4c95c...` (register+shield),
`0x49199f62...` (unshield), `0x713ffeeb...` (a second wallet's
register+shield) - had a **Ready X paymaster address as the transaction's
own sender**, not the wallet's own address. The user's wallet (`0x367903f...`
/ `0x00e5887f...`) never submitted any of these itself; only plain public
STRK transfers were ever self-submitted (checked all 9 of `0x00e5887f...`'s
outgoing transfers - none call `apply_actions`).

That raises the live question: when a Ready X wallet does a plain
**`transfer`** action (a donation) *without* going through MorokPay's
`/api/privacy/relay` - i.e. Ready X calls `wallet_strk20InvokeTransaction`
and submits it itself, the way the app's code does when `namesRecipient`
says relaying isn't needed - does Ready X *also* route that through its own
paymaster, making the donor invisible as sender **for free, natively**,
independent of anything this project built? Or does Ready X only sponsor
gas for its *own* first-party flows (Enable Private, Unshield) and submit
plain transfers as the wallet itself, the way the Sepolia
`unrelayed-demo.mjs` shows?

This is not yet tested either way. Every mainnet donation observed so far
went through *our* relay deliberately, so it proves our relay works - it
says nothing about what Ready X would have done on its own.

**How to check:** get a Ready X wallet to submit a first-time private
transfer to a brand-new recipient it has never paid before, and prevent
MorokPay's relay from touching it (e.g. temporarily set
`MOROKPAY_MAINNET_RELAY_ENABLED=false`, or just donate to an address the
`namesRecipient` check won't catch is safe to skip - actually don't try to
route around the app's own logic; simplest is a throwaway *outside* the app
entirely, straight from Ready X's own send UI to a fresh registered address,
mirroring `unrelayed-demo.mjs` but with a live wallet). Then read the
resulting transaction's `sender_address` the same way this session did for
every other example.

If Ready X does sponsor plain transfers too, this project's relay is still
correct to keep (Ready X's sponsorship is not something MorokPay controls or
can rely on - it could change, and the EVM rail has no equivalent at all),
but it changes how urgent/novel the mainnet donor-privacy story is for
messaging purposes, which is exactly what prompted the question.

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
- Three Ready X paymaster/infra addresses seen submitting on the user's
  behalf, never explained further: `0x57130b60...`, `0x22391d61...`,
  `0x4455355f...`. Likely different instances or roles of the same sponsor
  system; not investigated.
