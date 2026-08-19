# Claim links (deferred private delivery)

Status: **built on Sepolia, first park attempt in progress.** This note is for another agent to review the product case, the privacy tradeoffs, and what to build or reject next. It is not a tutorial.

Related: [private-invoices.md](private-invoices.md) (pay a registered merchant), [handoff.md](handoff.md) (repo constraints).

## The problem in one sentence

You cannot privately transfer STRK20 notes to someone who has not registered a viewing key in the pool. A Twitter giveaway, a first-time donation, and “here is $10, you do not have a till yet” all hit that wall.

Ready fails the simulation with empty legs (`-[]` / `+[]`) and `Транзакция не удалась`. The Wallet API skill states this as a hard stop: only the recipient can register, and you cannot do it for them. For pay-before-they-register flows it points at an escrow helper.

## Two product cases. Do not mix them

### A. Invoice QR — “I already take private payments”

Actor who creates the QR: the **recipient** (merchant, streamer, contestant who already joined the pool).

1. Recipient connects Ready on this network, creates an invoice on `/sell`.
2. Link looks like `/pay?to=<ready>&amount=&inv=&c=<invoice commitment>`.
3. Payer opens it and sends a private `transfer` (plus `MorokInvoices.privacy_invoke` so the till can mark paid from chain).

This is the shop / tip-jar loop. It **requires the recipient account to exist on this network and to be registered in the pool.** A Ready address is the same string on Sepolia and mainnet but is deployed per network. We verified: merchant `0x02afe2…` was deployed on Sepolia and **not** on mainnet, so a mainnet private pay to that QR failed even though Sepolia had worked.

### B. Claim link — “I am sending money to a stranger”

Actor who creates the QR: the **sender** (giveaway host, donor). The recipient does nothing up front.

1. Sender already has private USDC.
2. Sender parks an amount in `MorokEscrow` behind a random secret and shares `/claim?n=&s=<secret>&amount=`.
3. Recipient opens the link, connects Ready, claims into their own open note. Registration can happen at claim time.

This is the giveaway / “I picked three winners, here is your envelope” loop. The recipient does **not** generate a QR.

A public tweet with one claim URL is a bug: whoever opens it first takes the funds. One link per winner, sent privately (DM, reply, email).

## Contest story we actually want

Sergei announces a giveaway on Twitter: repost, three random people get ~$10 private USDC through MorokPay.

What **Sergei** does:

- Has private USDC on the network he is paying on (Sepolia to dry-run, mainnet for sprint evidence).
- For each winner: Get paid → **Claim link** → Park `N` USDC → copy the QR/link → send that link only to that person.

What a **winner** does:

- Install Ready, open the link, connect, press **Claim into private USDC**.
- They do not create an invoice, do not share an address with Sergei in advance, and do not need to understand channels.

What we still need to prove with a live claim: whether Ready will register + deploy the winner’s mainnet account during that one claim, with gas sponsored, and take the pool fee from the parked USDC. If claim requires the winner to already hold STRK or USDC, the contest copy has to say so.

## Protocol

Unofficial STRK20-by-example escrow pattern, rewritten and reviewed in-repo (not a copy-paste of the docs contract). The official skill says the example is unaudited; treat ours the same way.

Commitment:

```
commitment = poseidon(["MOROK_ESCROW:V1", secret])
```

Secret is 31 random bytes, in the URL as `s=`. Only the hash is stored on-chain.

**Park (sender), one STRK20 transaction:**

```
[
  { type: "withdraw", token: USDC, amount, recipient: MorokEscrow },
  { type: "invoke",   contract: MorokEscrow, calldata: [
      0,              // EscrowOperation::Deposit
      commitment,
      usdc,
      amount,
      0, 0            // secret and note_id ignored
  ] }
]
```

The pool must actually transfer `amount` of `token` to the helper. The contract checks `balance_of(escrow) >= escrowed_total(token) + amount` so a lying calldata cannot mint a claim against someone else’s parked funds. Deposit returns an empty `Span<OpenNoteDeposit>` (tokens stay). Emits `Escrowed { commitment, token, amount }`.

**Claim (recipient), one STRK20 transaction:**

```
[
  { type: "transfer", token: USDC, amount: "OPEN", recipient: claimer },
  { type: "invoke",   contract: MorokEscrow, calldata: [
      1,              // EscrowOperation::Claim
      0, 0, 0,        // ignored
      secret,
      "${openNoteIds[0]}"
  ] }
]
```

Claim recomputes `poseidon(TAG, secret)`, requires an unclaimed entry, approves the pool to pull `entry.amount`, returns one `OpenNoteDeposit`. Emits `Claimed { commitment }`. Second claim hits `ALREADY_CLAIMED`.

Anyone who knows the secret can claim (or reclaim unused funds). There is no recipient address in the contract. There is no refund entry point; unused parks are claimed back with the same secret.

Ready invoke calldata must be unpadded felts (`0x0` or no leading zero after `0x`) or a `${openNoteIds[n]}` / `${poolAddress}` placeholder. Padded `validateAndParseAddress` output is rejected with `INVALID_REQUEST_PAYLOAD` on `actions[1].calldata[n]`.

## Privacy. Be honest in the UI and in the tweet

| What | Public? |
| --- | --- |
| Sender and recipient addresses | No (pool withdraws to the helper; claim credits an open note) |
| Amount and token while parked | **Yes** — plain ERC-20 on `MorokEscrow` |
| Secret | Off-chain, in the URL. Leak = theft |
| After a successful claim | Back to a private note; parked balance goes to zero |

Invoice QRs keep amount+counterparty linkage off-chain and only publish an invoice commitment. Claim links are weaker on amount privacy by construction. For a $10 giveaway that is acceptable; for payroll it is not. Do not market this as “fully private until claimed” without the amount caveat.

Pool fee is billed per private operation, in the token that moves. Empirically a 6 USDC shield on mainnet credited ~5.84 private USDC (~$0.16, the 6 STRK fee). Gas on that shield was paid by a Ready relayer, not the user. **Pool fees are not sponsored.** A park costs the sender a fee; a claim costs the recipient a fee out of the parked amount unless we gross-up.

## What is in the repo today

| Piece | Where |
| --- | --- |
| Cairo `MorokEscrow` | `contracts/src/escrow.cairo` |
| Hash tests (cairo-test + vitest) | `contracts/tests/test_escrow.cairo`, `lib/pay/escrow.test.ts` |
| snforge state machine (no Windows snforge binary) | `contracts/snforge/test_escrow.cairo` |
| Sepolia deploy | `0x0407827c97ea537970b306f6ccbeb08c5f57224732280eb7b7a23184cad896a5` (pinned to Sepolia pool) |
| Mainnet deploy | not done (`MAINNET.escrow` is `""`, so the Claim link card hides) |
| Park UI | `/sell` → `GiveawayPanel` |
| Claim UI | `/claim` → `ClaimPanel` |
| Wallet actions | `depositToEscrow`, `claimFromEscrow` in `lib/starknet/actions.ts` |

Demo: https://morok-pay-starknet.vercel.app

## What is not done / not proven

1. **End-to-end park on Sepolia.** Payload padding was the last Ready rejection; the unpadded calldata is on `master` and has not been confirmed in a successful tx yet.
2. **End-to-end claim**, especially from a Ready that has never been on that network (the whole point).
3. **Whether Ready auto-withdraws to the helper on invoke**, making our explicit `withdraw` action a double-withdraw. If park simulates then reverts on chain, try invoke-only with the same calldata.
4. **Mainnet `MorokEscrow`.** Same constructor pattern as invoices: `node scripts/deploy-contract.mjs escrow mainnet`, then fill `MAINNET.escrow`.
5. **Expiry / refund UX.** Sender can claim their own link; the UI does not offer “reclaim” yet.
6. **Gross-up so the winner receives a round $10** after the claim fee.
7. **Do not put the secret in a public activity feed or Voyager toast** in a way that makes the claim URL reconstructible. Today the secret is in the QR and in `localStorage` (`morokpay.escrow-claims`) on the sender’s browser only.

## Constraints the next agent must not fight

- Ready Wallet API only. No viewing keys in the app. No direct Privacy SDK proving (`EMPTY_PROOF_FACTS`).
- At most one `privacy_invoke` per pool transaction.
- Sepolia txs are not sprint evidence. Mainnet pool fee is 6 STRK (`get_fee_amount`), taken from the moving token.
- The official escrow page is an unaudited example; we own review. The deposit `NOT_FUNDED` check is the load-bearing difference from the docs contract.

## Questions to think through

- Is a claim link the right giveaway mechanic, or should winners be asked to register first (one shield of dust USDC) and then receive a normal invoice pay? The second is more private (no public parked amount) but has worse onboarding.
- Should park be a dedicated `/give` door instead of a second card on Get paid? Get paid currently means “I am the merchant.”
- Should the link omit `amount=` (it is a hint only; truth is `get_entry`) so a forwarded screenshot leaks less?
- Is “anyone with the URL can claim” acceptable for Twitter DMs, or do we need to bind a claim to a registered address after the winner exists?
- For sprint judging: does a park+claim pair count as STRK20 integration depth (withdraw + invoke + open note), and do we need three mainnet txs that include this path?
