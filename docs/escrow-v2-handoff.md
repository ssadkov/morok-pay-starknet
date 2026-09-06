# MorokEscrowV2: current state and remaining UI work

Branch: `feat/escrow-v2`. Updated 2026-09-06. Keep `master` and the mainnet V1 flow intact. The earlier refund-to-sender-wallet design is superseded by [private refund](escrow-v2-private-refund.md).

## Product and privacy boundary

The sender pays out of STRK20 privately and shares a bearer link. An ordinary EVM wallet can receive the payment without buying STRK or paying transaction fees. **The current V2 claim is a public ERC20 payout.** Sender identity, not recipient destination or escrow amount, is what this design hides.

`indexed: false` only disables the convenience index. Events expose the commitment; `get_entry` exposes both owners, token, amount and expiry. Neither owner field may identify the sender's main wallet for a private link.

## Foundation implemented

- `/api/escrow/claim` checks the exact signed call, commitment, destination, funded entry owner, EIP-712 signature, network domain, relayer and expiry. Extra calls and unsupported account classes are rejected before spending. Both network kill switches and the 12 STRK gas cap apply.
- Refund uses an independent per-entry EVM recovery key. The new contract has `authorize_refund(commitment,note_id)` and a pool-only Refund operation; it has no public refund payout. Authorization binds the output note.
- `/api/escrow/refund` atomically deploys the recovery account if necessary, executes its signed authorization, and submits the matching private proof. The relayer pays gas and the pool fee. Public transfers and channel setup in this proof are rejected.
- `createEscrowV2Keys` and `refundEscrowV2Privately` are in `lib/privacy/escrow-refund-client.ts`. The deposit builder also requires a relayed proof and refuses a proof explicitly naming the main sender address.
- Failed token transfer/approval reverts contract state.

Deployment and verification evidence: [escrow-v2-private-refund.md](escrow-v2-private-refund.md). Older Sepolia addresses (`0x0156be9d…` public refund, `0x3cdfdb8e…` claim blocked after expiry) are historical, not upgraded in place. Existing entries cannot retroactively change rules. Mainnet V2 remains undeployed.

## Remaining work

### 1. `/stash` creates V2 entries with recoverable private refunds

`components/pay/stash-panel.tsx` still uses V1. Before switching:

- Call `createEscrowV2Keys(network)`: independent `claimSeed` and `refundSeed`, separate Starknet accounts derived through the factory.
- **Save and provide a recovery backup before funding.** Persist the refund seed, commitment, network, contract address and expiry privately. Current `recordActivity` metadata is not a recovery-key backup. This storage/export UI is not implemented. Never include `refundSeed` in the claim link.
- Use the derived `owner` and `refundOwner`. Never use the sender's main address as `refundOwner`, or derive recovery from the shared claim seed.
- Agree the default expiry with the product owner before shipping. Zero means never expires and never refundable; it must not silently become the default.
- Leave `indexed: false`. This reduces discoverability; it does not hide fields.
- Call `depositToEscrowV2` with `senderAddress` and `network` for local checks. Prepare private self-channel/subchannel separately if needed. Refuse public fallback or setup exposing the sender in this transaction.
- Build the recipient URL with `claimV2Url`. Before releasing V2 links, resolve the remaining URL-secret issue: `?k=` reaches the server and access logs.

### 2. `/claim` redeems V2 links and preserves V1

`components/pay/claim-panel.tsx` still reads V1 `?s=`. Add V2 parsing first, preserving V1 fallback. Do not interpret `?s=` as an EVM seed.

Read the entry and use `escrowV2Status`. Obtain the relayer through `/api/escrow/claim?n=...`; sign exactly one `claim(commitment,destination)` with the link key, pinning that relayer and a short expiry (e.g. 600 seconds). POST `{network,commitment,calldata,evmAddress,signature}`. The last signature is the link key's ownership proof for the factory; it does not replace the claim intent signature. Never send the seed to the API.

Explain that the V2 destination receives a **public** token balance. Account deployment and claim are sponsored; measure actual cost before publishing it.

### 3. Refund screen and recovery

Build a local list backed by recoverable records and a refund button calling `refundEscrowV2Privately`. It creates a private note for the sender, signs that note with the recovery key, and submits through the relayer. It requires an existing private self-channel; a proof exposing public setup fails before submission. Show pending/confirmed/refunded states and support importing the backup. Do not ship expiry without this usable path.

### 4. Mainnet after UI verification and a release decision

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
