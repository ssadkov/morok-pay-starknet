# MetaMask + Privacy SDK Sepolia test

Status: public account control, STRK20 registration, the 1 STRK shield/unshield
cycle, a 1 USDC shield/unshield cycle, and a USDC private-transfer transaction
are confirmed on Sepolia as of 2026-08-25. Recipient-side private balance
discovery is the next test stage.

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
| Shield 1 STRK | `0x03c898fd7a6a24431ed87f4054f317ac56fbac6b1b79274051138d212d6986e` | `SUCCEEDED`, block `14022244`; `1 STRK` shield, `2 STRK` pool fee, and `4.982030916506692056 STRK` gas. Private balance discovery changed from `0` to `1 STRK`. |
| Unshield 1 STRK | `0x07c034e212df5af9c0f81dc62454077373b96bfb68e8066ab8926e76a78af106` | `SUCCEEDED`, block `14025732`; `1 STRK` returned publicly, `2 STRK` pool fee, and `4.375067402903257608 STRK` gas. Public balance changed by `-5.375067402903257608 STRK` net. |
| Unshield 1 USDC | `0x060fd18fcc21ce8c7fa43208de35a0c0711e86f7ef4c54a32615c2ec04c9b44e` | `SUCCEEDED`, block `14035640`; exactly `1 USDC` moved from the pool to the generated public account, with a separate `2 STRK` pool fee and `4.432431986365654548 STRK` gas. |
| Shield 1 USDC | `0x0a1fe154197a3912a98dce41ecdfee98c117d450184caa205c6e3e3fe9fbfd9` | `SUCCEEDED`, block `14035805`; exactly `1 USDC` moved publicly from the generated account to the pool, with a separate `2 STRK` pool fee and `4.864508837315534848 STRK` gas. |
| Private USDC transfer | `0x0274ff470ea72bcb00cd8101b05a64e2cd765189186afb1f78ee38e5273d433b` | `SUCCEEDED`, block `14035837`; `2 STRK` pool fee plus `5.118527681170220634 STRK` gas. The public receipt does not reveal the private amount or recipient. |

Registration was prepared at proving block `14021087` with a real 225,040-byte
proof and nine proof facts. The final InvokeV3 batched the public STRK approval
and the pool `apply_actions` registration call. No shield or private transfer
occurred in that transaction.

The first shield required `autoSetup` because registration alone had not opened
the account's self-channel or STRK token subchannel. The successful transaction
batched those setup actions with the deposit in one pool `apply_actions` call,
so the pool fee was charged once. The public ERC-20 approval was limited to
exactly `3 STRK`: `1 STRK` deposit plus `2 STRK` pool fee. After discovery
indexed the resulting note, the same in-memory viewing key read a `1 STRK`
private balance.

The unshield selected and spent the single 1 STRK private note and withdrew to
the same public account. Its public approval was limited to the 2 STRK pool fee;
the withdrawn 1 STRK moved from the pool to the account. The signed maximum gas
bound was 12 STRK, but Starknet charged only the receipt's actual 4.3750674 STRK.
The lab now caps Eth712 gas independently of account balance so a large testnet
top-up cannot silently turn into a proportionally large signed resource bound.

The confirmed USDC unshield likewise withdrew exactly `1,000,000` base units
(`1 USDC`) from the pool to the same generated public account. Its STRK approval
and transfer events show a separate `2 STRK` pool fee, while the receipt charged
`4.432431986365654548 STRK` in actual gas. The transaction therefore cost
`6.432431986365654548 STRK` in total and did not deduct the fee from the USDC
amount. Discovery still needs to confirm that the spent private USDC note is no
longer included in the browser's private balance.

The subsequent USDC shield deposited exactly `1,000,000` base units and cost
`6.864508837315534848 STRK` in pool fee plus gas. The following private-transfer
receipt contains no public USDC transfer event and exposes neither the private
amount nor the recipient. It does expose the generated account's public call to
the pool, a `2 STRK` pool fee, and `5.118527681170220634 STRK` gas. The intended
amount and recipient must therefore be checked through the sender input and
recipient-side note discovery; the transaction hash alone is not payment proof.

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

## Faucet-funded onboarding

The lab now contains a no-Ready onboarding path for a fresh EVM account:

1. MetaMask signs the factory's fixed ownership message.
2. A server route verifies that signature, resolves the deterministic Starknet
   address from the live factory, requests a public Starknet Faucet challenge,
   solves its bounded SHA-256 proof of work, and returns only the faucet request
   status and public transaction hash.
3. The faucet funds the deterministic address. A manual transfer from the test
   treasury can be used if the faucet quota or cooldown is active.
4. A separate server-only Sepolia relayer verifies the same ownership proof and
   submits the public factory call. It refuses deployment until the generated
   address holds the configured minimum public STRK balance.

The relayer key is never exposed to the browser and must belong to a dedicated,
balance-limited Sepolia account rather than the 3,000 STRK test treasury. The
default deployment threshold is 10 STRK. Factory deployment previously cost
only `0.037221845127255808 STRK`; all later upgrade, registration, pool fees,
and transactions remain paid by the generated account. Faucet PoW, quota, and
cooldown are onboarding gates, not authentication or mainnet funding.

This implementation is not yet a confirmed onboarding result. A fresh MetaMask
EVM account, configured server relayer, faucet amount, faucet transaction hash,
deployment hash, cooldown response, and resulting account class must be recorded
before presenting the path as complete.

## Next bounded test

1. Refresh sender and recipient USDC balances after discovery. Record the
   entered transfer amount and confirm the same private-balance delta on both
   sides without treating the public transaction sender as the private recipient.
2. Perform a numeric USDC unshield from the recipient wallet and record its
   public destination, amount, pool fee, and actual gas.
3. If the recipient is a Ready account, repeat with a separately controlled
   MetaMask-derived account so signing and viewing-key custody are proven on
   both sides.
4. Configure the dedicated Sepolia relayer and run the new faucet-funded path
   with a fresh MetaMask account. Record both public hashes and actual balances.
5. Keep the treasury key out of the app and Vercel; only the limited relayer key
   may be stored as a server-only environment variable.
