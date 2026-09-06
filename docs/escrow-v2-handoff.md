# MorokEscrowV2: current state and remaining UI work

Branch: `feat/escrow-v2`. Updated 2026-09-06. Keep `master` and the mainnet V1 flow intact. The earlier refund-to-sender-wallet design is superseded by [private refund](escrow-v2-private-refund.md).

## Product and privacy boundary

The sender pays out of STRK20 privately. Two recipient modes:

1. **Bearer link** (`indexed: false`) — share `?k=`; anyone with the seed can claim.
2. **MetaMask invoice** (`indexed: true`) — park for a recipient EVM address; they open `/claim` with that wallet and claim from the indexed inbox. Commitment uses a random salt (no shared seed).

An ordinary EVM wallet can receive without buying STRK or paying fees. **The current V2 claim is a public ERC20 payout.** Sender identity, not recipient destination or escrow amount, is what this design hides.

`indexed: false` only disables the convenience index. Events expose the commitment; `get_entry` exposes both owners, token, amount and expiry. Neither owner field may identify the sender's main wallet for a private link. Invoice mode intentionally exposes the recipient owner so they can discover the entry.

## Foundation implemented

- `/api/escrow/claim` checks the exact signed call, commitment, destination, funded entry owner, EIP-712 signature, network domain, relayer and expiry. Extra calls and unsupported account classes are rejected before spending. Both network kill switches and the 12 STRK gas cap apply. Works for ephemeral link owners and real MetaMask owners.
- Refund uses an independent per-entry EVM recovery key. The new contract has `authorize_refund(commitment,note_id)` and a pool-only Refund operation; it has no public refund payout. Authorization binds the output note.
- `/api/escrow/refund` atomically deploys the recovery account if necessary, executes its signed authorization, and submits the matching private proof. The relayer pays gas and the pool fee. Public transfers and channel setup in this proof are rejected.
- `createEscrowV2Keys`, `createEscrowV2Invoice`, and `refundEscrowV2Privately` are in `lib/privacy/escrow-refund-client.ts`. The deposit builder also requires a relayed proof and refuses a proof explicitly naming the main sender address.
- `/stash` supports Share a link and Pay a MetaMask, with recovery backup before funding and private self-channel auto-open.
- `/claim` redeems `?k=` links, falls back to V1 `?s=`, and lists indexed invoices for the connected MetaMask.
- Failed token transfer/approval reverts contract state.

Deployment and verification evidence: [escrow-v2-private-refund.md](escrow-v2-private-refund.md). Older Sepolia addresses (`0x0156be9d…` public refund, `0x3cdfdb8e…` claim blocked after expiry) are historical, not upgraded in place. Existing entries cannot retroactively change rules. Mainnet V2 remains undeployed.

## Remaining work

### 1. URL-secret hygiene for bearer links

`?k=` reaches the server and access logs. Resolve before treating link mode as production-hard.

### 2. Mainnet after UI verification and a release decision

Preserve V1 compatibility and historical addresses. A new deployment cannot migrate old state or undo old privacy leakage. No mainnet V2 deployment or Vercel release is included in this change.

## Rules to preserve

- Claim destination and refund note belong inside the signed intent.
- `indexed: false` never means hidden owner fields.
- Fresh accounts/channels may be invisible at proving block `latest - 10`. Recovery deployment is outside the proof and can be batched with SRC9 authorization; the refund note belongs to the established sender account.
- Deposit action sets need replay protection by consuming an existing note. Public deposit followed by withdrawal alone yields `NO_REPLAY_PROTECTION`.
- Private accounts need channel and token subchannel setup. Never hide public registration/setup inside a supposedly private escrow transaction.
- Mainnet relay requires `MOROKPAY_MAINNET_RELAY_ENABLED=true`; Sepolia is enabled unless explicitly disabled.

## Checks

Run these from the repository root (Cairo commands in the named subdirectories):

```bash
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vitest/vitest.mjs run
node node_modules/next/dist/bin/next build
# In contracts/: scarb build && scarb cairo-test
# In contracts/forge/: snforge test
node scripts/escrow-v2-probe.mjs
node scripts/escrow-v2-probe.mjs --submit  # consumes Sepolia test STRK
# Explicit opt-in EVM/API test; bash syntax:
MOROKPAY_ESCROW_LIVE_TEST=1 node node_modules/vitest/vitest.mjs run scripts/escrow-v2-relay.live.test.ts
```

Live tests require mature private notes/self-channel for `spare` and funded Sepolia role accounts. The EVM/API test saves recovery material under `.secrets` before funding; it invokes the real handler in-process, without HTTP transport or UI. Normal test runs skip it.
