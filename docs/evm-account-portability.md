# Portable EVM-owned STRK20 accounts

Status: the scheme is live on mainnet and permissionless to use. This document
is the specification another application would implement against. Nothing here
is a proposal - every address and hash below is deployed and has processed real
transactions.

## The question this answers

If a user onboards to STRK20 through MetaMask in MorokPay, can a different
application resolve the same Starknet account and read the same private
balance?

Today: **not without implementing this document.** Not because anything is
locked, but because two values must match exactly, and one of them is currently
MorokPay-branded. Both are published below.

By contrast, a user who connects **Ready** is portable across every dapp that
speaks the STRK20 Wallet API, because Ready owns the viewing key and the Wallet
API is StarkWare's standard rather than ours. That is the tradeoff this path
makes: no Starknet wallet required, at the cost of ecosystem-wide portability
until somebody else adopts this scheme.

## What has to match

### 1. The factory address

An account address is derived, not assigned:

```
account = pedersen(
  'STARKNET_CONTRACT_ADDRESS',
  factory_address,          // <- load-bearing
  eth_address,              // salt
  PRIMER_CLASS_HASH,        // hard-coded in the factory
  pedersen([])              // empty constructor calldata
)
```

`factory_address` is part of the hash. A second factory deployed from identical
source produces **different addresses for the same EVM key**. There is no
recovery from picking the wrong one - it is a different account.

Rather than reimplementing the derivation, call the factory:
`get_expected_account_address(eth_address)` returns the address whether or not
it is deployed.

| | Starknet Mainnet |
| --- | --- |
| `AccountFactory` | `0x7ead3a89ae0a67ed6ba18caa1b9643437ff9432bab66ab0b2a27e46e0c627aa` |
| `StarknetEth712Account` class | `0x0697437b25b81bcdd2d1b231d3b8670849fb318555903dbc2fefce2a1a35586e` |
| `Primer` class | `0x00123e6bc1c14ae9934e933d3f64916a6116dd6b036a922b2b1f0815e0d1d300` |

`Primer` was declared by StarkWare, not by us. The other two were declared and
deployed by MorokPay on 2026-08-26; the account class is built unmodified from
`starkware-libs/starkware-starknet-utils`, `packages/accounts`.

**`deploy_account` is permissionless.** Its Cairo carries no role check -
compare `set_account_class_hash`, which does call `only_app_governor()`. Any
application can deploy an account for any EVM address through this factory
today, given that address's ownership signature. It does not need MorokPay's
cooperation or a key from us.

### 2. The viewing-key derivation

The viewing key is derived from a signature over one specific EIP-712 message.
EIP-712 domain separation is doing its job here: a signature over any other
message yields a different key, so "sign something meaning roughly this" does
not interoperate. The message must be byte-identical.

```jsonc
{
  "domain": {
    "name": "MorokPay Privacy Access",   // load-bearing, see below
    "version": "1",
    "chainId": <the EVM chain the wallet is connected to>
  },
  "primaryType": "PrivacyAccess",
  "types": {
    "PrivacyAccess": [
      { "name": "purpose",        "type": "string"  },
      { "name": "evmAccount",     "type": "address" },
      { "name": "starknetChain",  "type": "string"  },
      { "name": "privacyPool",    "type": "uint256" },
      { "name": "accountFactory", "type": "uint256" }
    ]
  },
  "message": {
    "purpose": "Derive the MorokPay STRK20 viewing key",
    "evmAccount": "<connected EVM address>",
    "starknetChain": "SN_MAIN",
    "privacyPool": "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    "accountFactory": "0x7ead3a89ae0a67ed6ba18caa1b9643437ff9432bab66ab0b2a27e46e0c627aa"
  }
}
```

The resulting signature goes through `deriveViewingKey(signature, starknetAddress)`
from `@starkware-libs/starknet-privacy-client`. Source of truth in this
repository: `lib/privacy/eip712-test.ts`.

`chainId` is a domain-separation value, not a bridge. It is whatever EVM
network the wallet reports; the account's on-chain validator reconstructs the
digest from calldata and never consults an external chain.

### 3. Signing pool operations

Two different signers, for two different things:

- **`Eip712TypedDataSigner`** (from `@starkware-libs/starknet-privacy-client/signers`)
  authorizes the pool's `CallSet` - the operation itself. Note the normalization
  in `normalizedCallSet` (`lib/privacy/evm-strk20-account.ts`): the SDK hands
  over a typed-data object whose `chainId` and `verifyingContract` need coercing
  before viem will sign it.
- **`Eth712TransactionSigner`** (`lib/privacy/eth712-transaction.ts`, ours)
  signs the outer `InvokeV3` that the account itself submits. This one is not
  in the SDK - it implements the typed-data layout `StarknetEth712Account`'s
  `__validate__` expects, including the `execution_resources` encoding.

A full worked example, script form, is `scripts/mainnet-eth712-probe.mjs`: local
EVM key to deployed, registered, mainnet pool participant, with no Ready
anywhere in the path.

## The two honest problems

**The domain name says MorokPay.** It is `"MorokPay Privacy Access"`, and it is
now load-bearing: the pool commits the derived public key on-chain at
registration, so an account registered under this domain cannot move to a
neutral one without re-registering under a new address. Any other application
implementing this must show MorokPay's name in its users' MetaMask prompt, which
is a bad look for them and unearned branding for us.

The fix is a neutral, versioned domain (`"STRK20 EVM Access"` / version `"1"`)
- cheap to do while only test accounts exist, expensive after real users
register. Deliberately not done yet: it is a breaking change and the sprint
deadline is closer than the first real user.

**We hold `set_account_class_hash`.** The factory's governance admin is a
MorokPay key, so we can point future deployments at a different account class.
Existing accounts are unaffected - a deployed account's class is fixed at
deployment - but anyone building on this factory should know the upgrade
authority is not theirs and is not renounced.

## Roadmap

Three tiers, in the order they are worth doing.

**Tier 1 - publish the spec.** This document plus the constants, offered to the
sprint's builder channel. A team wanting MetaMask onboarding could implement
against it in a day, using our already-deployed factory and paying nothing. The
sprint's own judging note says a project other teams depend on counts in its
favour, and this is the cheapest way that becomes true. Cost: hours.

**Tier 2 - extract a package.** `lib/privacy/eth712-account.ts`,
`eth712-transaction.ts`, `evm-strk20-account.ts` and `network.ts` are already
close to standalone; what couples them to MorokPay is the branded domain string
and the network table. Publishing them as one package with the domain as a
constructor argument is a day or two, and it is the version worth doing
alongside the neutral-domain rename rather than before it.

**Tier 3 - a hosted deploy relayer, and nothing more.** The one piece that
genuinely wants to be a service is the undeployed-account problem: a fresh
account cannot pay for its own deployment, so somebody must submit
`deploy_account` and eat the gas. `app/api/privacy-sdk/deploy/route.ts` already
does exactly this and could be opened publicly behind rate limiting.

Everything else must stay client-side. A hosted API that derives viewing keys
would mean the server sees them, which is the whole privacy model handed to a
third party. If this scheme is ever offered as "an API", that boundary is the
part that must not move.
