# MorokPay

Private USDC treasury on Starknet for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon).

Connect **Ready**, fund native USDC from Ethereum through **CCTP**, shield into the official STRK20 pool, then pay out to a fresh Starknet address.

## Flow

1. Connect Ready (Wallet API v6). Ready holds the STRK20 viewing key and talks to the official proving service.
2. Burn USDC on Ethereum with MetaMask (`depositForBurn`). Circle attests the message. Ready calls `receive_message` on Starknet.
3. Shield public USDC with `wallet_strk20InvokeTransaction` `{ type: "deposit" }`.
4. Payout with `{ type: "withdraw", recipient }` to an address you paste.

The product is **ETH in → private USDC on Starknet → unshield to a new address**. Hidden OpenZeppelin derivation is left in `lib/starknet/derive.ts` for later, once proving access is not wallet-gated.

## Why Ready

The official STRK20 pool only accepts deposits with proof facts from the hosted proving service. That service is IP-whitelisted to Ready and Xverse. Direct Privacy SDK `apply_actions` calls revert `EMPTY_PROOF_FACTS`.

This app does **not** clone the [STRK20 starter kit](https://github.com/Akashneelesh/strk20-starter-kit) UI. It uses the same Wallet API (`WalletAccountV6`) for shield and payout, plus Ethereum CCTP inbound.

## Addresses (Starknet mainnet)

| What | Address |
| --- | --- |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Starknet USDC | `0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb` |
| MessageTransmitterV2 | `0x02EBB5777B6dD8B26ea11D68Fdf1D2c85cD2099335328Be845a28c77A8AEf183` |
| Ethereum USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Ethereum TokenMessengerV2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` |

Default RPC is `https://rpc.starknet.lava.build`. Override with `NEXT_PUBLIC_STARKNET_RPC_URL`. Set `NEXT_PUBLIC_STARKNET_NETWORK=sepolia` only for experiments.

## Scripts

```bash
npm install
cp .env.example .env.local
npm run dev
npm test
```

Open [http://localhost:3000](http://localhost:3000). Install [Ready X](https://chromewebstore.google.com/detail/ready-x/dlcobpjiigpikoobohmabehhmhfoodbb) before connecting.

Sprint evidence (`strk20.json` transactions, demo URL, 3-minute video) is filled after the first mainnet txs that touch the official pool.

Live demo: [https://morok-pay-starknet.vercel.app](https://morok-pay-starknet.vercel.app).

## License

MIT
