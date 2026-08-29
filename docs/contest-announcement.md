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

---

# Telegram post (Russian, video attached)

One post, not a thread, for the author's own subscribers - they already know
him, so it can be first-person in a way the X thread cannot. The video carries
the walkthrough, so the post frames it and gives the action.

Entries are accepted **both** as replies in the X thread and as comments under
this post; both get merged into `entries.txt` at the close. Splitting the
audience across two platforms and then only counting one of them would throw
away the entrants who need the least convincing. The follow-and-repost
requirement stays on X only - imposing it on subscribers who are already
subscribed is friction where conversion matters most.

Close time in the post is given as Moscow time with UTC in brackets:
31 August, 18:00 MSK = 15:00 UTC = 20:00 Almaty.

---

**MorokPay - приватные донаты на Starknet**

Собрал за спринт STRK20 и выкатил в мейннет. Автор публикует один QR - кто
угодно донатит по нему, а в блокчейне не остаётся ни адреса донатера, ни
суммы. Автор видит, что деньги пришли; никто не видит, откуда.

Сегодня проверил это на реальной мейннет-транзакции, где я знаю обе стороны:
адреса отправителя нет ни в конверте транзакции, ни в calldata. Пусто.

Работает на двух рельсах: Ready X - или вообще на голом MetaMask, без
Starknet-кошелька.

**Теперь мне нужны живые люди, чтобы это погонять.**

$20 в USDC, первые 7 заявок. Приём до 31 августа, 18:00 МСК (15:00 UTC).

Ты в роли автора: публикуешь свой донат-QR так, как это сделал бы блогер, а я
реально донатю по нему USDC.

Как участвовать:

1. Открыть MorokPay, подключить Ready X - или MetaMask. На MetaMask
   приложение само сгенерирует Starknet-аккаунт: закинь на него немного STRK,
   с него пойдёт шаг 2
2. Один раз включить Private (~6 STRK - это комиссия пула STRK20, не моя)
3. Создать донат-QR, сумму оставить пустой
4. Скачать PNG
5. Прислать его в комментарии под этим постом - или реплаем в тред в X

Куда придёт приз: в твой приватный STRK20-баланс, обычным приватным переводом.
Не на публичный адрес, без всякого клейма. Поэтому Private обязательно должен
быть включён - иначе призу просто некуда лечь.

$20 разойдутся случайно между всеми, кто дойдёт до конца, максимум на 7
человек. Место определяет хеш блока Starknet, который появится уже после
закрытия приёма - заранее его знать нельзя. Чем меньше дойдёт, тем больше
каждому. Кто дошёл - без приза не останется.

И честно про одну вещь: QR-ссылка публикует адрес, который принимает деньги, и
выкладываешь её ты сам. На MetaMask это одноразовый аккаунт, который приложение
создаёт под это, основной кошелёк нигде не светится. На Ready X это твой
реальный адрес Ready X - заходи с того, который не жалко показать.

Приложение: https://morok-pay-starknet.vercel.app
Тред в X: [ссылка]
