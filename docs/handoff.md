# Handoff

MorokPay is a private donation product on Starknet for the STRK20 Private Sprint. The current sprint cut is not a generic wallet or merchant checkout.

## Done (2026-08-26)

The MetaMask entry path is live on mainnet, end to end, confirmed from the
browser rather than from a script:

- Mainnet proving and discovery services are reachable and unauthenticated -
  the assumption that they were whitelisted to Ready and Xverse was wrong, and
  a plain SRC6 account can register through the pool's SNIP-12 fallback.
- `StarknetEth712Account` and `AccountFactory` are declared and deployed on
  mainnet; `Primer` was already there. Total cost of the whole stack: ~$4.70.
- A real MetaMask account deployed and registered in the live pool through the
  deployed app. `strk20.json` carries six verified pool transactions.
- `/privacy-sdk-lab` is network-aware on both chains. Mainnet deliberately
  requires a self-funded account; only Sepolia sponsors.

## Current focus

1. **Record the three-minute submission video.** This is the only hard
   requirement still missing and it is binary - 13 of 151 projects have one.
   Everything below is worth less than this.
2. Dry-run the First 10 campaign with registered Ready accounts.
3. Dry-run the new one-button EVM onboarding on both networks with a fresh
   MetaMask address. `Connect EVM wallet` now works on mainnet as well as
   Sepolia and no longer dumps the user into the lab.
4. Configure `MOROKPAY_MAINNET_RELAYER_PRIVATE_KEY` in the deployment
   environment; the relayer account is deployed and funded but the browser
   deploy route cannot sign without it.
5. Replace the public unauthenticated mainnet RPC before campaign traffic.
6. Publish [evm-account-portability.md](evm-account-portability.md) to the
   sprint channel. The factory is permissionless, so another team can adopt the
   scheme without asking; the sprint's judging note says work other teams
   depend on counts in a project's favour.
7. Add a downloadable branded QR image with the donation label and MorokPay logo
   while preserving a reliably scannable payment link.
8. Return to the unshield-fee design after that; do not charge a MorokPay fee on
   every private donation. See [fees.md](fees.md).
9. Fund EVM accounts through CCTP straight into the pool, removing the manual
   STRK top-up mainnet onboarding still needs. StarkWare's `privacy-bridge`
   already does this with CCTP v2 hooks and its `InboundAnonymizer` is live on
   mainnet; two to three days to adopt. See
   [evm-account-portability.md](evm-account-portability.md).
10. Rename the viewing-key EIP-712 domain from `MorokPay Privacy Access` to a
    neutral versioned string - **post-sprint**. It is a breaking change that
    strands already-registered accounts, and only test accounts exist today.
11. Build DonationPot only if the core submission is complete. Lantern shipped
    the same idea with a video and five mainnet transactions.

## Product flow

- `/` — choose Donate or My QR.
- `/pay` — open or paste a donation request, choose an amount, and pay privately.
- `/sell` — activate STRK20 and create one reusable open-amount Donation QR.
- `/treasury` — Base CCTP top-up, shield, private balances, and payout.
- `/privacy-sdk-lab` — EVM onboarding, shield/unshield, and diagnostic
  operations, network-aware on mainnet and Sepolia. Donate and My QR connect an
  already-onboarded EVM account from their shared header, but that shared
  adapter is still Sepolia-only.
- `/claim` — compatibility route for previously issued `MorokEscrow` links; it is not linked from the current product UI.

Donation requests and app activity are stored in the current browser. Old invoice, sale, and Drop links remain parseable so existing URLs can still open, but those flows are not presented as product choices.

## Technical boundary

Mainnet MorokPay currently uses Ready Wallet API methods for private balances
and transactions. Ready owns the viewing key, note discovery, proving, and
submission in that flow. Do not ask users for viewing keys.

The Sepolia EVM beta uses MetaMask EIP-712 signatures, a deterministic Starknet
smart account, and the Privacy SDK directly. It must not be confused with Ready
Wallet API support or presented as evidence that MetaMask implements STRK20
wallet methods. The app derives its viewing key in browser memory only. The
shared EVM adapter currently implements private-balance discovery and one
private transfer action for Donate; shield/unshield remain in the lab. See
[metamask-privacy-sdk-sepolia.md](metamask-privacy-sdk-sepolia.md).

A donation is a normal `wallet_strk20InvokeTransaction` transfer. No helper contract is involved. Ready exposes balances, not private transfer history, so the creator refreshes the balance and explicitly marks a donation received.

MorokPay's planned service fee belongs at the app's `Unshield` step, not inside each private donation. The current direct-wallet architecture cannot enforce that fee if a user unshields in Ready instead of MorokPay. See [fees.md](fees.md).

The deployed `MorokInvoices` event is not settlement proof: an empty-note helper cannot authenticate the hidden recipient, token, or amount of a separate transfer action. See [private-invoices.md](private-invoices.md).

## Submission state

- Ready wallet with pool activity: `0x00e5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423`.
- `strk20.json` lists six succeeded mainnet pool transactions, all verified to
  carry a pool event. Three are Ready relayer transactions; three are from the
  EVM path, two of those signed by the generated account itself.
- Mainnet EVM stack: factory `0x7ead3a89ae0a67ed6ba18caa1b9643437ff9432bab66ab0b2a27e46e0c627aa`,
  deploy relayer `0x34d43acc20256972081101fe26be76bf4abbb4a191d7d4630e3fe527183c792`
  (deployed and funded; its key is not yet in the deployment environment).
- Live demo: https://morok-pay-starknet.vercel.app
- Three-minute video: missing and required for scoring.
- `contracts` in `strk20.json` stays empty on purpose: listing the factory would
  require every listed transaction to carry an event from it, which none of the
  pool transactions do.
- Mainnet `MorokEscrow`: not deployed. Do not create or advertise mainnet claim links.
- DonationPot: designed, not implemented.

## Safety

- Never commit `.secrets/` or funded keys.
- Do not attribute a private transfer to the Starknet transaction sender.
- Do not describe STRK20 as complete anonymity: deposits, withdrawals, open-note amounts, timing, and app-side actions can be public.
- Do not treat a request, local received status, or `InvoiceSettled` event as cryptographic payment proof.
- Existing claim URLs are bearer secrets. Anyone who learns one can claim its funds.
