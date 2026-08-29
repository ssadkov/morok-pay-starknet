# Contest announcement - X thread

Terms: [private-contest.md](private-contest.md). Post on 2026-08-30, entries
close **2026-08-31 15:00 UTC**.

Three posts. Post 1 is the product, carries the image, and has no link. Post 2
is the instructions and the link. Post 3 is the prize mechanic and the one
caveat worth saying out loud.

Before posting:

- refill the mainnet relayer (34.93 STRK held, ~63 STRK needed for 7 payouts);
- entries arrive as QR **PNGs**, but `scripts/allocate-contest.mjs` reads
  links. At the close, decode each PNG back to its `/pay?...` URL to build
  `entries.txt`. The QR encodes exactly the link the Copy link button gives.

---

## 1 - The product (image here, no link)

🕶️ MorokPay does private donations on Starknet.

A creator publishes one QR. Anyone can donate to it. The chain does not record
who donated - not the donor's address, not the amount. The creator sees the
money arrive; nobody sees where it came from.

⚡ Live on mainnet with real money, on both rails: Ready X, or plain MetaMask
with no Starknet wallet at all.

🎁 Now I need real people to run it. $20 in USDC, first 7 entries, closes
Aug 31, 15:00 UTC.

## 2 - How to enter (link here)

I'm testing both rails with real users, and you play the creator. Publish your
donation QR the way a blogger would, and I'll donate real USDC through it.

1. Follow me and repost this thread
2. Open MorokPay and connect Ready X - or just MetaMask, no Starknet wallet
   needed. On MetaMask, MorokPay derives a Starknet account for you: send it
   some STRK first, that account is what pays step 3
3. Enable Private once (~6 STRK, charged by the STRK20 pool, not by me)
4. Create a donation QR, leave the amount empty
5. Download the PNG and reply to this thread with it

https://morok-pay-starknet.vercel.app

## 3 - The prizes

$20 in USDC, distributed at random among everyone who completes the entry,
capped at 7. Ranks come from sha256(seed + entry list hash + your address),
where the seed is the first Starknet block after entries close - a number
nobody can know while entering. Fewer finishers means bigger prizes, and
nobody who finishes gets nothing.

"Completes the entry" includes having Private switched on. The prize is a
private transfer into your private STRK20 balance - if Private isn't enabled,
there is nowhere for it to land.

One thing worth saying out loud: your QR names the address that receives, and
you're posting it. On MetaMask that's a throwaway account MorokPay derives for
you, and your own wallet never appears. On Ready X it's your Ready X address,
so enter with one you don't mind posting.

Closes Aug 31, 15:00 UTC.
