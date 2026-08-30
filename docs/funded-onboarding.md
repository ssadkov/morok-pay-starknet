# Funded onboarding: bridge, swap, shield

Status: researched 2026-08-28, not designed in detail and not built. The
on-chain findings below were verified against mainnet; everything after
"Sequence" is a proposal.

## The problem

A supporter who arrives with USDC on Base and no Starknet wallet cannot get to
a private balance without first acquiring STRK. Every step after the bridge
costs gas in STRK:

1. `receiveMessage` to mint the bridged USDC on Starknet;
2. the STRK20 deposit that shields it;
3. the pool fee, which is charged in STRK on top.

`EvmOnboardingGate` currently refuses mainnet onboarding below 15 STRK for this
reason, and tells the user to send it themselves. That instruction is the
largest single drop-off in the EVM path: it asks someone who wanted to donate
USDC to go buy an unrelated token on an exchange they may not have.

## What already exists

CCTP **V2** is wired: `TokenMessengerV2.depositForBurn` on Base, Circle's v2
attestation API, then `receiveMessage` on Starknet's MessageTransmitter
(`lib/cctp/`, `components/treasury/fund-panel.tsx`). Starknet is CCTP domain 25.
The burn and the mint work; the mint is executed by the user's own Starknet
account, which is exactly where the STRK requirement bites.

## Verified findings

**The account supports SNIP-9 outside execution.** The account class behind
every EVM-derived account
(`0x0697437b25b81bcdd2d1b231d3b8670849fb318555903dbc2fefce2a1a35586e`) exposes
`execute_from_outside_v2` and `is_valid_outside_execution_nonce`. A relayer can
therefore submit calls and pay their gas while the user only signs an EIP-712
intent in MetaMask. This is the primitive AVNU's paymaster is built on.

**Outside execution cannot carry a STRK20 proof.** The struct is
`OutsideExecution { caller, nonce, execute_after, execute_before, calls }` -
there is no proof field. Shield, unshield and private transfer pass the pool
proof as a *transaction-level* extension
(`account.execute(calls, { proof, proofFacts })`, see
`lib/privacy/evm-strk20-account.ts`), not inside calldata. **A shield cannot be
relayed**, and no amount of paymaster work changes that; it would need the
account or the pool to accept a proof through outside execution.

**Hooks are not the mechanism.** CCTP does not execute hooks itself - `hookData`
is opaque metadata carried alongside the burn. Something still has to call
`receiveMessage` on Starknet and act on the result. A hook does not remove the
need for a relayer, so `depositForBurnWithHook` is not the unlock it looks like.

Confirmed 2026-08-31 against the deployed mainnet ABIs rather than from
reading. `TokenMessengerMinter`
(`0x07d421B9...`) exposes `deposit_for_burn_with_hook`, but that is the
*outbound* side - burning from Starknet. Inbound it exposes only
`handle_receive_finalized_message(remote_domain, sender,
finality_threshold_executed, message_body)`, which mints to the recipient and
dispatches nothing: there is no handler interface, no call into the recipient,
no hook execution. `MessageTransmitter` (`0x02EBB577...`) exposes
`receive_message(message, attestation)` and nothing hook-shaped at all.

**But the two knobs that matter are both there**, and together they are worth
more than a hook would be:

- `mint_recipient` is chosen at burn time on Base, so the USDC can be minted
  straight into a helper contract of ours rather than into the user's account;
- `receive_message` is unrestricted, and `destination_caller` - also set at
  burn time - restricts who may call it. Setting it to our relayer stops
  anyone else triggering the mint and leaving the funds parked in the helper
  with nothing to settle them.

So the relayer submits **one Starknet transaction**:

```
[ MessageTransmitter.receive_message(message, attestation)   → mints USDC to Helper
  Helper.settle(user, route, min_strk_out, fee)              → swaps, forwards, charges ]
```

That is the hook, implemented by us. It is also how the pattern works on EVM,
where Circle likewise only carries the bytes and a hook-receiving contract does
the work.

**This answers open question 2 below.** A half-completed bridge is not a state
this can reach: the mint and the swap are in the same transaction, so a swap
that reverts on slippage reverts the mint with it, the CCTP nonce is not
consumed, and the same attestation can be replayed with a wider tolerance. The
cost of a failed attempt is the relayer's gas, which is question 1 and stays
real.

## Sequence

The constraint above rules out one atomic "bridge and shield", but not the goal.
Splitting at the proof boundary works:

```
Base                    Starknet (relayer pays gas, SNIP-9)      Starknet (user pays)
burn USDC   ──────────► receiveMessage        (mint USDC)
                        swap USDC → STRK      (AVNU)
                        transfer service fee  (MorokPay)
                                                            ────► shield USDC
```

Step 2 is one batch of ordinary public calls, all relayable, all inside a single
intent the user signs once. It leaves STRK in the account, which is what pays
for step 3. So "shield in the same transaction" is out; "shield without ever
having bought STRK by hand" is in.

## Which venue

Route through **AVNU**, not Ekubo directly. AVNU is the aggregator carrying the
large majority of Starknet swap volume and routes into Ekubo, which holds most
of the AMM liquidity - the same execution with less routing code, from the same
vendor as the paymaster.

## Monetization

The service fee would be an explicit transfer call inside the batch the user
signs, so it is visible before approval and never held in custody. Circle's
`maxFee` is Circle's fast-transfer fee and is not revenue.

This is a **second** fee, and it does not replace or contradict
[fees.md](fees.md): that decision charges on the in-app unshield, at the public
edge, and stays. A funding fee is charged at the entry edge instead, which is
also public, and is not bypassable the way the unshield fee is - a user who
does not want it can bridge and swap themselves.

## Open questions

1. Who runs the relayer, and what stops it being drained? Gas is spent before
   the fee is collected, so a failed or reverted batch is a direct loss.
2. ~~What happens when the bridge half-completes - USDC minted, swap reverted
   on slippage?~~ **Answered**: the mint and the swap share one transaction, so
   there is no half-completed state to recover from. See the hook finding
   above.
3. Slippage and minimum size. Below some amount the swap plus fee costs more
   than the STRK it buys, and the flow should refuse rather than quietly eat it.
4. Whether the pool fee can be paid out of the same swap in one batch, or
   whether it forces a second user-signed transaction.
5. **Legal shape.** Taking a cut of a cross-chain transfer is
   money-transmission-shaped. This needs an answer before it ships, not after,
   and it touches the same question already open on the AIFC track.

## Not now

This is a relayer service - key custody, nonce management, rate limiting, abuse
handling - plus an AVNU integration, fee accounting and refund paths. Weeks, not
days. It is deliberately out of scope for the STRK20 sprint and belongs after
it.
