# DonationPot

Status: designed, not built. Ship after the donation UI and the First 10
contest. Skip it rather than delay those.

A private donation is a normal STRK20 `transfer`. No helper sees the amount, so
no contract belongs on that path. DonationPot is a **second rail**: an anonymous
jar with a public running total.

## Why it exists

A private QR puts USDC in the creator's shielded balance. The chain cannot
honestly show "raised $420 from 17 people". DonationPot is the jar on the
table: anyone can see it get heavier; nobody sees who dropped the bill.

Use it when a campaign page needs an on-chain thermometer. Do not use it when
the product promise is a fully private tip (hidden who **and** amount).

## Two rails

| | Private donation | DonationPot |
|---|---|---|
| Who | hidden | hidden (tx is relayed) |
| Amount | hidden | public: pool → jar |
| Live total | no (viewing key only) | yes (jar ERC-20 balance) |
| Auto gift, match, split, lend the pot | no | yes: the helper sees `amount` |
| Contract | none | the jar **is** the contract |

Cairo does not process a private tip. Cairo **is** the jar: accept USDC from
the pool, add it to `total` / `count`, hold it, later give it back to the pool
to credit the creator's open note.

## Sweep: can the creator take it privately?

Yes, if "wallet" means the shielded STRK20 balance, not a public Ready address.

On `Sweep` / `Claim`:

- Visible: the jar balance falls by `$X`; `$X` returns to the pool as an open
  note (token and amount are plaintext by protocol).
- Hidden: **who owns that note**. Observers cannot point at a Ready address and
  say "that is the blogger's money".

The Starknet transaction is submitted by the relayer, not the creator.

This breaks if the creator then **unshields** to a public address, an exchange,
or CCTP. That edge is public (recipient, token, amount). While the funds stay
inside the pool (or go to Vesu through a helper), the destination stays hidden.

People will still infer that "this campaign's jar was emptied". Timing around
the end of a stream is correlatable. The guarantee is address unlinkability,
not "nobody knows a withdrawal happened".

## Where Cairo sits

```
donor private tx (relayed)
  → pool withdraws USDC to DonationPot     // public amount
  → privacy_invoke: record amount, hold    // Cairo
  → (later) creator Sweep
  → helper approves the pool, returns OpenNoteDeposit
  → pool credits the creator's open note   // owner hidden, amount public
```

Access control cannot be `get_caller_address() == blogger`. The caller is
always the pool. "Only I can empty the jar" is a one-time secret or a pot
admin key, same class of problem as `MorokEscrow`. A reusable secret in
`privacy_invoke` calldata would leak on the first sweep (the pool → helper
call is public). One full sweep of a pot is the simple case.

Do not emit a `Tipped` event and call it proof of a hidden transfer. That is
the failed `MorokInvoices` pattern.

## Later, not now

Once Donate works on Sepolia through Ready:

- optional perk if `amount >= threshold`, from inventory the creator prepaid
  (needs two open notes in one transaction);
- `Sweep` into the official Vesu helper instead of liquid USDC (the pot total,
  not each donation).

Neither is a reason to write Cairo before the donation UI and the contest.
