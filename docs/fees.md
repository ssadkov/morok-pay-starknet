# Fee policy

Status: product decision recorded on 2026-08-25; not implemented on `master`.

This file is about the fee **MorokPay would charge**. For who currently pays
the fees that already exist - the pool's and the chain's - and how much they
have measured, see [who-pays.md](who-pays.md).

## Decision

Do not add a MorokPay service-fee transfer to every private donation. Keep the
donation as one direct STRK20 transfer so the supporter pays only the fees
required by Ready, its paymaster, and the privacy pool.

Charge the MorokPay service fee when the creator uses MorokPay to unshield
USDC. The intended UX is one amount and one confirmation: MorokPay shows the
gross withdrawal, its fee, and the net public amount before opening Ready.

Exact fee units, rate, minimum, rounding, and recipient remain undecided. Do
not hardcode them until the Sepolia flow and receipt have been measured.

## Privacy and fee boundary

An unshield is a public edge of STRK20. Its destination, token, amount, and
timing are visible on-chain. A MorokPay fee collected at that edge must also be
described as public; it must not be presented as a hidden donation split.

Pool fees and paymaster reimbursement are protocol/wallet costs, not MorokPay
revenue. Product copy and receipts must show them separately from the MorokPay
service fee.

## Enforcement limitation

MorokPay currently uses Ready's Wallet API and never controls the user's keys
or shielded balance. Therefore the service fee can be applied only to an
unshield initiated through MorokPay. A user can bypass it by unshielding in
Ready directly.

Enforcing the fee across every exit would require a different custody or
contract architecture and would change the product's trust and privacy
boundary. That is deliberately out of scope for the current donation MVP.

## Before implementation

1. Verify on Sepolia whether net withdrawal and fee can be expressed in one
   Ready Wallet API transaction and whether that incurs one or more pool fees.
2. Record the pool fee, paymaster reimbursement, public ERC-20 movements, and
   final balances from the transaction receipt.
3. Define failure and retry behavior so a confirmed withdrawal cannot leave
   MorokPay showing a permanent loading state.
4. Decide whether the bypassable in-app fee is sufficient for the MVP. If not,
   design the required contract separately before changing the direct donation
   rail.

The experimental `codex/private-donation-fee` branch is evidence from the
earlier per-donation fee test. It is not the fee design selected for `master`.
