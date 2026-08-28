# Relayed submission and what the pool publishes

Status: verified against the pool's Cairo source, not yet exercised on chain.
Read before choosing between the private-donation rail and DonationPot - the
two differ in what they leak, and both depend on the findings below.

Sources: `starkware-libs/starknet-privacy` at the vendored tag commit
`66e3caae` (`PRIVACY-0.14.3-RC.5`, the version under `vendor/`) and at `main`
`980da8af`. Findings that differ between the two are marked.

## The pool does not authenticate its caller

`apply_actions(actions, screening)` runs `validate_proof` and `collect_fee`,
then applies the actions. There is no `get_caller_address` check anywhere on
that path, in either commit. Authorization is the transaction's
`tx_info.proof_facts`, which must contain exactly
`compute_message_hash(actions, pool_address)`.

The payer's own signature is verified earlier and elsewhere: inside the proven
view, `assert_valid_signature` (`packages/privacy/src/utils.cairo`) checks the
account's custom validation, the SN tx hash, or the SNIP-12 `CallSet` hash. The
prover builds that invocation with `sender_address` set to the pool itself, so
the user's address never reaches the chain.

Consequences:

- **A relayer can submit any proven action set.** Nothing binds the proof to a
  submitter, so the private-rail sweep and any donation can be sent by a third
  party. This is what `docs/donation-pot.md` assumes; it is now checked.
- **The proof is bearer.** Anyone who sees an unsubmitted proof can submit the
  same actions. They cannot alter them (the message hash covers `actions`), so
  the risk is a lost fee, not a lost note.

## The fee is charged to the caller, not the payer

`collect_fee` transfers `fee_amount` STRK with `sender: get_caller_address()` -
identical in both commits. So the relayer pays the pool fee (`6 STRK` on
mainnet, `2 STRK` on Sepolia) out of its own balance, and the account whose
notes are being spent needs no STRK at all.

This removes the one funding link that would otherwise expose a receive-only
account: a second account never has to be topped up from the creator's main
address to pay its own fee.

## What each action publishes

| Action | Public on chain |
| --- | --- |
| Shield / deposit | `TransferFrom.from_addr`, token, amount; `Deposit.user_addr` |
| Unshield / withdraw | `Withdrawal.to_addr`, token, amount |
| Pool registration | `ViewingKeySet.user_addr` and its public viewing key |
| Helper invoke | `ExternalContractInvoked.contract_address` and selector; calldata is not emitted |
| Open note (helper rail) | `OpenNoteDeposited.depositor`, token, note id, amount |
| Channel setup (first transfer to a given recipient) | `Append.recipient_addr` in plaintext calldata |
| Private transfer over an existing channel | `EncNoteCreated { note_id, packed_value }` and `NoteUsed { nullifier }` - no address, no plaintext amount |

A private transfer over an existing channel is therefore the only operation
that names nobody. Every helper-based flow publishes its amounts, because the
pool moves plain ERC-20 to and from the helper.

## Channel setup names the recipient

`AppendInput` carries `recipient_addr` as a plain `ContractAddress`, and
`_apply_append` pushes into `recipient_channels: Map<ContractAddress,
Vec<EncChannelInfo>>`. A channel exists per sender-recipient pair, so the
**first** transfer from a given payer to a given recipient puts the recipient's
address, in the clear, into a transaction the payer usually submits themselves.
Later transfers over that channel name nobody.

Two consequences for a published receive address:

- An unrelayed first payment publicly links that payer to that address. Relay
  the first payment to a recipient, or accept the link.
- `get_num_of_channels(recipient)` is a public view, so the number of distinct
  senders who ever opened a channel to an address is public - a donor count
  without amounts, and without a contract.

## The auditor sees more than the public

`Withdrawal.enc_user_addr` and `OpenNoteCreated.enc_recipient_addr` are
documented in `packages/privacy/src/events.cairo` as decryptable by the
auditor. An open note - the way a helper credits a creator - therefore carries
the note owner's address encrypted to the auditor. A plain private transfer
emits `EncNoteCreated`, which carries no address at all.

State this accurately in any privacy claim: the helper rail hides the owner
from the public, not from the auditor.

## Version risk for any helper contract

`main` adds `open_note_depositor_screening_policies`, a per-contract map read in
`_apply_invoke_and_deposits`. Its default variant is `Required`
(`packages/privacy/src/objects.cairo`), which makes the helper's own address the
screening subject: an open-note deposit then needs a fresh screening
attestation signed by the screener key. `Exempt` and `Delegated` are set only by
the pool's app governor.

The vendored RC.5 has no such map - there, screening covers only a regular-pool
deposit's `TransferFrom.from_addr`.

So on a pool built from current `main`, `MorokEscrow` or a DonationPot cannot
credit an open note until StarkWare either sets a policy for that contract
address or the screening service attests it. Which version is deployed on
mainnet is not established here. Confirm it before committing to the helper
rail; the private-transfer rail is unaffected either way.

## Not yet verified on chain

The reading above is from source. Still to do, in one Sepolia transaction each:

1. Submit a proven `apply_actions` from an account other than the payer, and
   confirm the pool accepts it and charges the submitter the fee.
2. Call `get_open_note_screening_policy` on the deployed pools (mainnet and
   Sepolia) - it exists only on the newer pool, so the call failing is itself
   the answer.
