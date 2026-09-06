# V2 private refund revision — 2026-09-06

The revised contract keeps the sender's main address out of refund ownership
and returns tokens to a private STRK20 note. This is a new Sepolia deployment,
not an upgrade of the previous V2 contract. Mainnet V1 is unchanged.

## Authorization and money flow

1. Before funding, generate independent random claim and recovery seeds.
   Derive two Starknet accounts through the Eth712 factory. Store/export the
   recovery seed privately; share only the claim seed. The browser UI for this
   backup is still required before enabling V2 deposits.
2. Deposit from private notes through a relayer. Public escrow storage contains
   the two per-entry accounts, amount, token and expiry. Neither account is the
   sender's main wallet. `indexed: false` is not storage confidentiality.
3. After expiry, the recovery key may reclaim, but the claim link still works.
   Prepare an open note addressed privately to the sender's established STRK20
   account. The recovery key signs `authorize_refund(commitment,note_id)` with
   a pinned relayer and short expiry. First successful exit (claim or refund)
   wins.
4. The relayer atomically submits factory deployment (if needed), the signed
   SRC9 call, fee approval and pool `apply_actions` proof. The pool calls
   `privacy_invoke(Refund(note_id),commitment,...)`. The helper consumes the
   authorization, closes the entry, approves the pool and returns one
   `OpenNoteDeposit`. No public refund destination exists.

The recovery account needs neither STRK nor pool registration. It authorizes
outside the proof, so it can be deployed in the refund transaction. The private
note belongs to the established sender account, whose channel/subchannel must
already be available at the proving block. Both client and refund relay reject
public setup in the refund path. There is no fallback to public payout.

## Relay checks

The claim and refund routes share `lib/privacy/escrow-server.ts`. A separate
ownership signature only authorizes factory deployment; the server independently
recovers the signer of the exact EIP-712 intent and matches its derived account
to the funded entry's owner (or recovery owner). The intent permits one specific
escrow operation, with exactly two arguments, the correct commitment and
destination/note, pinned caller and an expiry within 15 minutes.

The refund parser decodes the installed RC.5 pool ABI and permits exactly one
open-note creation and the matching escrow Refund invoke. Extra public actions,
registration, channel setup, different tokens/notes/helpers or trailing calldata
are rejected. Cryptographic validity is checked by fee simulation and the chain.
Gas is capped at 12 STRK, and a pool fee above 12 STRK is refused. Both network
relay switches apply. Rate limiting remains per process, not a durable global
spending budget across all Vercel instances.

## What is and is not hidden

Observers still see the escrow commitment, amount, token, expiry, ephemeral
claim/recovery accounts, relayer, refund event and output note identifier. They
can link a refund to its escrow. They do not get the main sender address from
this flow when its private channels are ready and deposit/refund are relayed.
Open-note amounts are public. Timing/amount correlation remains possible; the
relayer also sees network metadata, and the existing proving/discovery trust
boundaries remain. This is not a promise of absolute anonymity.

The recipient's V2 claim remains public. Old V2 entries with the main sender as
`refund_owner` are already linked and cannot be made private retrospectively.
The contract cannot determine whether an arbitrary address is someone's main
wallet; independent key generation and the no-public-submission rule are client
requirements. Keep the recovery seed out of logs, URLs, API bodies and recipients'
backups. The existing `?k=` claim URL also needs a separate secret-transport fix
before V2 UI release.

## Sepolia deployment

| Item | Value |
| --- | --- |
| Contract | `0x3cdfdb8e26c8d05f54eee93e0c78617a018c36eb3f23ce71dce7d440dc507c` |
| Class | `0x233b12c28de0dfc956463e232e37caa889dd6f330080ec8d044384e26247f46` |
| Declare tx | `0x7cb9d154e2124bb79fc8afbcbe3b6142e081533c39cd0d1d4acbf33ba928f1a` |
| Deploy tx | `0x2d52994923d33d075de004bb99a3eb34bd67a8dd70e8786b5156dfafd540695` |
| Pool | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Minimums | 1 USDC / 5 STRK |

[Contract on Voyager](https://sepolia.voyager.online/contract/0x3cdfdb8e26c8d05f54eee93e0c78617a018c36eb3f23ce71dce7d440dc507c).

## Verification

- Scarb 2.12.0 builds the contract; the existing three Cairo tests pass.
- Foundry 0.49.0: 12 contract tests, including unauthorized/early/double refund,
  wrong note/pool, exact expiry and rollback of failed token transfer/approval.
- Vitest: 233 local tests; the opt-in live EVM/API test is skipped normally.
- TypeScript, targeted ESLint and production build pass.

App constants on `feat/escrow-v2` point at this deployment with
`escrowV2SupportsPrivateRefund: true`. **Redeploy before relying on
claim-after-expiry:** the rule change (expiry unlocks refund only; claim
stays open) is in source and needs a new class/address. Live probe and
EVM/API results are recorded below after their receipts and balance checks
complete. `scripts/escrow-v2-probe.mjs` uses ordinary Starknet accounts to
test contract rules. `scripts/escrow-v2-relay.live.test.ts` additionally tests
fresh EVM recovery and the real refund handler in-process, without HTTP or UI.
