# Legacy claim links

Claim links are retained only so previously issued links can still be redeemed. New claim-link creation is not part of the current private-donation UI.

## Deployment status

- Sepolia `MorokEscrow`: deployed and supported by `/claim`.
- Mainnet `MorokEscrow`: not deployed.

Do not publish or promise new mainnet claim links until the helper is deployed, audited, and tested end to end through Ready.

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
