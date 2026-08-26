# MetaMask + Privacy SDK Sepolia test

Status: public account control, STRK20 registration, the 1 STRK shield/unshield
cycle, a 1 USDC shield/unshield cycle, a USDC private-transfer transaction, and
a fresh-account MetaMask onboarding through a dedicated server relayer are
confirmed on Sepolia as of 2026-08-26. Recipient-side private balance discovery
and the atomic 20 STRK sponsored variant are the next test stages.

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

## Fresh MetaMask onboarding result

- EVM owner: `0x76af1622c80a7302c80b1429a4c1575945a56e9f`.
- Deterministic Starknet account:
  `0x079c035509d371a29aedae6f0834e590a2e200b2bee44fcbe0c3ebdbc6c96ce1`.
- Dedicated Sepolia relayer:
  `0x04d6417a0493814a0bb964d704cf544b722d3f44a99ba3d936e8b8577af42030`.
- Relayer deployment transaction:
  `0x04cf58950f3ac32cd3528b3de9d4cf90068281eef963259888bbe5f5225743ec`;
  `SUCCEEDED`, with `0.071747129727181878 STRK` gas.
- Public faucet funding transaction:
  `0x0348b659fe49a55dd8161e8aef0f6802849bf18330e9ee508cd6a07e003f6695`;
  exactly `5 STRK` reached the undeployed deterministic address.
- Factory deployment transaction:
  `0x048fc2df2eed002d807c61f038eac0418e1adf203a6d569a9d17c8ba7d869b93`;
  `SUCCEEDED`, block `14041639`, with
  `0.693526254887962828 STRK` gas paid by the dedicated relayer.
- Resulting account class:
  `0x039ffe6e5bffb04de53189d1f4018f113d7ddcbc8ca5874f7a4986b4d1a77f55`.

The generated account retained all 5 faucet STRK after deployment. The factory
event stored the EVM owner above. The relayer is only the public transaction
sender and gas payer; it does not hold the account signing or viewing key.

The faucet UI later displayed a misleading failure because a repeated challenge
returned the expected 24-hour address cooldown even though the first transfer
had succeeded. The current home-page beta avoids that dependency: one relayer
Invoke transfers only the amount required to bring an undeployed account to 20
STRK and then calls the factory atomically. This new variant must be confirmed
with another fresh EVM account after deployment.

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

## Sponsored onboarding

The first no-Ready onboarding test used the public faucet:

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

The current implementation replaces those separate funding and deployment
requests with one atomic relayer Invoke. It tops an undeployed account up to 20
STRK, then submits the factory call. A factory revert also reverts the transfer;
after deployment the route returns `already_deployed` instead of refilling the
account. All later upgrade, registration, pool fees, and transactions remain
paid by the generated account.

The relayer key is never exposed to the browser and belongs to the dedicated,
balance-limited Sepolia account above rather than the test treasury. For this
Sepolia promotion the same key funds and deploys. This is not a mainnet funding
design.

## Next bounded test

1. Refresh sender and recipient USDC balances after discovery. Record the
   entered transfer amount and confirm the same private-balance delta on both
   sides without treating the public transaction sender as the private recipient.
2. Perform a numeric USDC unshield from the recipient wallet and record its
   public destination, amount, pool fee, and actual gas.
3. If the recipient is a Ready account, repeat with a separately controlled
   MetaMask-derived account so signing and viewing-key custody are proven on
   both sides.
4. Run the atomic 20 STRK sponsored path with a second fresh MetaMask account.
   Record its single public hash, funded balance, account class, and actual gas.
5. Keep the treasury key out of the app and Vercel; only the limited relayer key
   may be stored as a server-only environment variable.

## Shared Sepolia app integration

Donate and My QR now show `Connect EVM wallet` beside Ready on Sepolia. After
the injected wallet connects, MorokPay resolves the deterministic Starknet
address and independently verifies:

1. the account is deployed;
2. its live class hash is the approved STRK20-compatible Eth712 class;
3. `get_public_key` confirms registration in the live privacy pool.

Failure at any gate shows the exact Starknet address and sends the user to this
lab. A ready account can read its private balances and prepare a private USDC
donation through the Privacy SDK. Shield and unshield remain in the lab for the
Sepolia test so their public edges, pool fee, gas cap, and proof are reviewed
explicitly.

The registration UI previously kept the parent account inspection from before
the self-upgrade. Registration could confirm on-chain while Shield and USDC
cards remained hidden until a page refresh. Upgrade and registration
confirmation now refresh the parent inspection immediately; transaction state
and class state no longer diverge in the UI.

## Mainnet status (2026-08-26)

The mainnet proving service and discovery service are live, unauthenticated,
and answer the same JSON-RPC as their Sepolia counterparts. Confirmed with
`scripts/mainnet-prover-probe.mjs`, which asks the question without deploying
anything and without spending anything:

- `discovery-service.alpha-mainnet.sw-dev.io/health` returns the mainnet chain
  head with a single-digit second lag.
- `transaction-prover.alpha-mainnet.sw-dev.io` accepts
  `starknet_proveTransaction` with no credential.
- A registration proof for the ordinary OpenStarknet account
  `0x3b0f997f8ef8e1532406037be4d9c57d0fbc870a5af518fe0abdb92a6458bba` returned
  in 4.1 seconds: 309,312 felts, nine proof facts, proof version `PROOF1`.
- The mainnet pool charges `6 STRK` per operation, read from `get_fee_amount`.

That proof was requested through `Snip12CallSetSigner`, not through the Eth712
path. The pool verifies an OR-fallback,
`is_valid_signature(compute_call_set_hash(account, calls), sig)`, so a plain
SRC6 account signing a SNIP-12 `CallSet` is a first-class depositor and needs
no custom account class. This is a second non-Ready route into STRK20, and it
works on mainnet today.

Proving is therefore **not** what blocks MetaMask on mainnet. What blocks it is
deployment: `AccountFactory` is absent from mainnet and neither the `Primer`
class nor the STRK20-compatible `StarknetEth712Account` class is declared
there. Both are open source in `starkware-libs/starkware-starknet-utils`
(`packages/accounts`). Configuring the mainnet factory to point straight at the
STRK20-compatible class also removes the separate self-upgrade transaction that
Sepolia required.

Do not read this as permission. The endpoint being open is not the same as the
STRK20 team intending it for sprint traffic; ask before putting user volume
through it.

### Confirmed on-chain

The proof was submitted and the pool accepted it.

| | |
| --- | --- |
| Transaction | `0x2b82b0c6bb056cfa6af1036a1a178b9de84f6f91567925456e87b5d84e1096d` |
| Result | `SUCCEEDED`, `ACCEPTED_ON_L2`, block `13887364` |
| Account | `0x3b0f997f8ef8e1532406037be4d9c57d0fbc870a5af518fe0abdb92a6458bba`, OpenZeppelin Account v1.0.0 |
| Signature | SNIP-12 `CallSet`, stark key, no custom account class |
| Pool fee | `6 STRK` |
| Actual gas | `2.682059588286245 STRK` |
| Proof | 314,692 felts, nine proof facts, `PROOF1`, returned in 3.9s |
| `get_public_key` after | `0x1e5d9659076e794dc6163289e0a4a6f3c5027b94b46bd14adf81b06cb7fc9b5` |

An ordinary Starknet account is therefore a registered STRK20 participant on
mainnet, reached through the Privacy SDK and the public proving service, with
no Ready and no bespoke account contract. Total cost was 8.68 STRK.

The viewing key came from `passphraseViewingKeyProvider`. The pool stores the
derived public key permanently, so the passphrase cannot be rotated after
registration and cannot be recovered if lost. That is acceptable for a payer
who transacts and leaves; it is a custody hazard for a creator holding a
shielded balance, and is the reason Ready stays the recommended route for the
receiving side.

### Mainnet deploy relayer

The browser deploy route (`/api/privacy-sdk/deploy`) needs a funded Starknet
account to submit `deploy_account` on a new user's behalf and pay its own gas
- it never transfers STRK to the connecting account on mainnet (see
`app/api/privacy-sdk/deploy/route.ts`). This is a plain OpenZeppelin account,
generated and deployed 2026-08-26 for that role alone, separate from the
existing Sepolia relayer:

| | |
| --- | --- |
| Address | `0x34d43acc20256972081101fe26be76bf4abbb4a191d7d4630e3fe527183c792` |
| Deploy transaction | `0x17d96e01628c10154372e1e1fd80a5f66e7c8c4b326c39e11e3234e5e1431d0`, `0.075 STRK` |
| Role | `MOROKPAY_MAINNET_RELAYER_ADDRESS` / `_PRIVATE_KEY` |
| Funded with | `15 STRK` for gas only - enough for roughly ten `deploy_account` calls at the ~1-2 STRK each has cost so far |

Kept deliberately separate from the Sepolia relayer: reusing one key across a
test and a real-money network is an unnecessary way to widen what a key
compromise costs. Top up as the balance runs low; it holds no other funds and
has no role beyond paying its own gas.

### What is still missing for MetaMask

Nothing on the contract or infrastructure side - only wiring this relayer's
private key into the deployment environment
(`MOROKPAY_MAINNET_RELAYER_PRIVATE_KEY`) makes the browser path work end to
end. `AccountFactory` is live and configured with the STRK20-compatible
`StarknetEth712Account` class; `Primer` was already declared by StarkWare. The
account address derives from the EVM address as salt plus the fixed `Primer`
class hash, so the same compiled `Primer` must stay declared or every derived
address changes.

A browser Starknet wallet signing the same `CallSet` is untested. The signer
builds the digest with direct `poseidonHashMany` rather than
`typedData.getMessageHash`, because the SNIP-12 domain `version` is the numeric
felt `1` and typed-data encoding would treat the declared `shortstring` as
ASCII. A wallet that computes the hash from typed data on its own side may
therefore produce a different digest. Do not claim Argent or Braavos support
before one of them has signed a `CallSet` the pool accepted.

### The MetaMask path itself, confirmed on mainnet (2026-08-26)

`scripts/deploy-eth712-factory.mjs` declared the STRK20-compatible `Eth712`
account class and `AccountFactory` on mainnet by re-declaring the exact bytes
already live on Sepolia (`scripts/fetch-class.mjs` pulls them over RPC and
refuses to write anything that doesn't rehash to the class hash asked for -
account addresses derive from a hard-coded `Primer` class hash, so a rebuild
that shifted it by one compiler version would move every address). `Primer`
itself needed no work: StarkWare had already declared it on mainnet.

| | |
| --- | --- |
| `Eth712` account class declare | `0x3b29d8a2cd0b536bcc067ed65adb823d708baf63508865fb1d0432f1da197d4`, `33.85 STRK` |
| `AccountFactory` class declare | `0x5cbc0979186dff8b983a37593695cfa65bebb6a9c28bdc05926c832d829a88`, `37.64 STRK` |
| `AccountFactory` instance deploy | `0x7920a73972e256d09a116c44440ff4d86b6abd60859eba7fd2f93467b3ae78e`, `0.71 STRK` |
| Factory address | `0x7ead3a89ae0a67ed6ba18caa1b9643437ff9432bab66ab0b2a27e46e0c627aa` |

`scripts/mainnet-eth712-probe.mjs` then drove the path StarkWare's stack exists
for: a local EVM key (viem's account signer, cryptographically identical to
what MetaMask itself produces for `eth_signTypedData_v4` and `personal_sign` -
the account's on-chain validator cannot tell them apart) signed the factory's
ownership message, deployed its deterministic Starknet account through that
factory, signed the pool's `CallSet` authorization as EIP-712 typed data, and
submitted its own `InvokeV3` - the account validating its own transaction, no
Ready involved at any step.

| | |
| --- | --- |
| EVM address | `0x7f5C9666A0Ba912Dd5E5bdd8154271e45B955da9` |
| Derived Starknet account | `0x36b11089ce5a8ffef7adabdd67f32951fa36499b013553a781a1ef6c311ff94` |
| Deploy (funded + factory call, one relayer tx) | `0x4f550991adf6b5da36252e2fb097c871d74c146187862e171dee7b7dd16c02d` |
| Pool registration (self-signed InvokeV3) | `0x78abd030f99f94b757aee36dd32cb77bc864ee6fc116503259a02e47b472617` |
| `get_public_key` after | `0x5ebb2a0637e63fe308fbc6001caf716f065366b9dccab57cfbae8704a40e71` |

One timing note for anyone repeating this: the first registration attempt
failed with `Requested contract address ... is not deployed`, because the
prover builds its proof against a block ~10 behind head, and that block still
predated the deploy transaction. Waiting for more blocks to pass and retrying
succeeded - this is the same proving-block-depth constraint noted above for
Sepolia, just met from the other direction.

### Confirmed through the browser, with a real MetaMask (2026-08-26)

Everything above was driven by scripts with a local EVM key. The same path then
ran end to end through the deployed app at `/privacy-sdk-lab`, in a browser,
with the MetaMask extension producing every signature:

| | |
| --- | --- |
| EVM owner | `0x5371486EdF41539725aC5E35FfeB24725eD3ABF9` |
| Derived Starknet account | `0x06c90d9b384e76a72435b87634153999b8690b3305e18a43613ab368fea887a9` |
| Deploy through the factory | `0x6ab36fb2b64e42dfb584594876bae028958be69b2d4eb81289d24acb336894`, block `13897879` |
| Pool registration | `0x21b12f4dbebf9271d5142f44b75439c0e9944608416e47e55b511d04d7f22d0`, `SUCCEEDED`, block `13898265`, `4.42 STRK` gas |
| `get_public_key` after | `0x40e1abf7f60f7a7a7c011e39d3db97e3675980337b86d023c4a715bb708a99b` |

The factory's `AccountDeployed` event on the deploy transaction carries the EVM
owner and the account address, and `get_expected_account_address` for that EVM
address returns the same account - the derivation is verifiable from outside
the app.

This is what the scripted run could not prove: that MetaMask's own
`eth_signTypedData_v4` implementation, not just viem's local signer, produces
signatures the deployed account validates. The remaining gap is the reverse of
what it was - the lab is confirmed on mainnet, while `Connect EVM wallet` on
Donate and My QR still routes through `lib/privacy/evm-strk20-account.ts`,
which has not been repointed yet.

For what another application would need in order to resolve the same account
and read the same private balance, see
[evm-account-portability.md](evm-account-portability.md).
