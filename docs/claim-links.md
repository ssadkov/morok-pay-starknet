# Claim links

Claim links were legacy - kept only so old links could still be redeemed - until
the claim side became worth showing on its own: whoever opens one now collects
with MetaMask alone, holds no STRK, and MorokPay pays for their transaction.
Creating one is `/stash`; redeeming one is `/claim`.

The design this belongs to, and every measurement behind it, is
[evm-escrow-invoices.md](evm-escrow-invoices.md).

## Deployment status

- Sepolia `MorokEscrow`: `0x0407827c97ea537970b306f6ccbeb08c5f57224732280eb7b7a23184cad896a5`.
- Mainnet `MorokEscrow`: `0x06199365a45fa8fe4874bb82727fdf5d849631cde9ca557f497abe7c4ccb698f`,
  deployed 2026-09-04, declare `0x592d1c0c...`, deploy `0x741b45d3...`, 6.67 STRK
  all in. Same class hash as Sepolia (`0x53fe2c18...`), so it is byte-for-byte
  the contract the Sepolia probes exercised.

**Deployed is not audited.** Nothing here has had an external review, and the
mainnet round trip has not been run end to end yet. Size what is parked
accordingly.

## Why the route exists

A normal STRK20 transfer requires the recipient to be registered in the pool. A claim link lets a sender park USDC before the recipient has registered:

1. The sender parks USDC in `MorokEscrow` behind a random secret.
2. The URL carries that secret as bearer authorization.
3. The recipient opens `/claim`, connects Ready, and claims into an open private note.

The claim route recomputes `poseidon(["MOROK_ESCROW:V1", secret])`, reads the escrow entry, and asks Ready to execute the claim action.

## Privacy and security boundary

- Sender and recipient addresses are hidden by the pool interaction.
- The parked token and amount are public while held by `MorokEscrow`.
- The URL secret is equivalent to cash: anyone who obtains it can claim.
- There is no separate refund method; the sender can reclaim with the same secret.
- One link must be shared with one intended recipient through a private channel.

Keep `/claim`, `lib/pay/escrow.ts`, `lib/starknet/escrow.ts`, the escrow actions, and the Cairo escrow contract together. Remove the compatibility route only after confirming that no issued links still hold funds.
