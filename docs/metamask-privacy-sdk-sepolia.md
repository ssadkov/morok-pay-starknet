# MetaMask + Privacy SDK Sepolia test

Status: public account control and STRK20 registration confirmed on 2026-08-25.
Shield, private balance, private transfer, and unshield are the next test stages.

## What this path is

This is not MetaMask Starknet Snap and it is not an EVM transaction path.
MetaMask keeps an ordinary EVM key and signs EIP-712 messages. MorokPay derives a
deterministic Starknet smart-account address from the connected EVM address. The
deployed Starknet account validates those EIP-712 signatures and submits normal
Starknet InvokeV3 transactions.

The isolated test page is `/privacy-sdk-lab`. Production donation pages still
use the Ready Wallet API; this lab does not imply that an arbitrary EVM wallet
implements `wallet_strk20InvokeTransaction` or any STRK20 Wallet API method.

## Confirmed identities and contracts

- MetaMask EVM owner: `0x70d5d723ba7f39cfb676c67bbd4b5d6ae8047f4b`.
- Deterministic Starknet account: `0x07fc0cbd7ad8307a8318be7c1a658bcac67a4e522dbebf2e04dc5ea3c0ce7eec`.
- Account factory: `0x078ce3c3e3080a579d268feae011761b32146efd40f4faa14dc8b9a30b4de35f`.
- Initial account class: `0x039ffe6e5bffb04de53189d1f4018f113d7ddcbc8ca5874f7a4986b4d1a77f55`.
- STRK20-compatible account class: `0x0697437b25b81bcdd2d1b231d3b8670849fb318555903dbc2fefce2a1a35586e`.
- Sepolia privacy pool: `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`.
- Ready test treasury and deployment gas payer: `0x00e5887fc74a11d10ad5dd2f69d3911fb352d9b811528a9281ca8abac8498423`.

The Ready address above paid for the public factory deployment only. It is not
the generated account, its owner, signing key, or private-transfer sender.

## Confirmed transactions

| Step | Transaction | Result and measured cost |
| --- | --- | --- |
| Factory deployment | `0x072be624e3d94689f849d6cc9f3bd1dffe23fe33d4cb06e84b1fbd64f5985228` | Confirmed; public gas paid by the Ready relayer account. |
| Public 0.01 STRK transfer | `0x026c60b28c9c677cc20e0355e73d34509a126688d9e67bde819b3c2bf2ada4d` | `SUCCEEDED`; generated account paid `1.303148503138092678 STRK` gas. |
| Account self-upgrade | `0x03f6bff4901d225efea1238543862ffb231bf7e75c60dfcfadb20b164c8a6997` | `SUCCEEDED`; generated account paid `1.261148222351904366 STRK` gas. Address and EVM owner were preserved. |
| STRK20 registration | `0x07deccfc10ccd7fb878d6482f892c08c46a2059cd22da299566e996cb26a3df` | `SUCCEEDED`, block `14021124`; `2 STRK` pool fee plus `4.331302638639205626 STRK` gas. |

Registration was prepared at proving block `14021087` with a real 225,040-byte
proof and nine proof facts. The final InvokeV3 batched the public STRK approval
and the pool `apply_actions` registration call. No shield or private transfer
occurred in that transaction.

## Compatibility findings

1. The factory initially deployed an account whose custom CallSet validator had
   the older two-argument ABI. The current pool calls a three-argument validator
   with `additional_data`, so registration failed with `INVALID_SIGNATURE`.
2. A separate public self-upgrade to the compatible class was required. An
   atomic upgrade plus registration cannot work with this proving flow because
   the proof is constructed against a block approximately ten blocks behind the
   final transaction.
3. The default Cartridge Sepolia endpoint reported Starknet RPC `0.9.0` and
   discarded `proof_facts` during fee estimation. The lab uses a dedicated
   privacy RPC endpoint reporting `0.10.3-rc.0` and refuses versions older than
   `0.10.1`.
4. The RC5 SDK mock estimator generated proof version `PROOF0`, which current
   Sepolia rejected. The real prover returned `PROOF1`; estimating the exact
   real proof-backed transaction succeeded. The lab never rewrites proof facts.

These are protocol/RPC compatibility constraints, not MetaMask wallet-method
capabilities. MetaMask supplies EIP-712 signatures; MorokPay and the Privacy SDK
construct the Starknet and STRK20 operations.

## Key custody and privacy boundary

- MetaMask retains the EVM signing key. MorokPay never asks for or stores its
  seed or private key.
- A repeatable EIP-712 signature deterministically derives the viewing key. In
  the current lab it exists only in memory in the browser tab and is discarded
  on reload or disconnect.
- Public deployment, upgrade, STRK transfer, shield, and unshield transactions
  expose their normal Starknet edges. A relayer address is a public gas payer,
  not evidence of the private user or recipient.
- Only transfers performed inside the STRK20 pool are intended to hide the
  amount and sender-to-recipient relationship. Registration itself is public.

## Next bounded test

1. Re-derive the viewing key in the current tab and confirm discovery reports
   the account as registered.
2. Prepare a 1 STRK shield with a real `PROOF1`, show pool fee and funded gas
   bounds, and require a separate MetaMask confirmation to broadcast it.
3. Record the shield hash, receipt, public token movement, actual gas, and
   resulting private balance.
4. Only then test a private transfer and unshield. Do not add a relayer until
   the account can complete the STRK20 lifecycle and withdraw funds.

