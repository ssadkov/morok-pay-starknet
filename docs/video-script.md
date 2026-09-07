# Сценарий демо-видео

Рабочий документ под конкретную запись, поэтому по-русски — его читают вслух.
Английская версия снимается второй, после того как русский дубль покажет, где
провисает.

Требование спринта: демо-видео — одна из трёх проверяемых галочек хаба
(`demo`, `video`, `mainnet`). У проекта её пока нет.

## Решение: снимаем только MetaMask, обе роли

Ready X в кадре не появляется. Причина не в том, что он не поддержан — он
поддержан и работает. Причина в том, что **весь дифференциатор лежит на другой
рельсе**, и обе его половины метамасковые:

- сторона автора: QR публикует **не** его кошелёк, а отдельный приёмный
  аккаунт;
- сторона донатера: платёж без старкнет-кошелька вообще.

На Ready X мы честно равны нативному: их QR это адрес кошелька, наш на этой
рельсе тоже, а отправителя их пеймастер прячет и без нас. Показывать это в
кадре — значит либо умолчать, либо объяснять, почему у нас так же.

Ready X упомянуть **одной фразой голосом**, без переключения экрана: «эта же
ссылка работает и для Ready X; рельса, которую я показываю, — та, где
старкнет-кошелёк не нужен вообще».

Порядок: **сначала автор создаёт QR, потом донатер платит.** Оба — MetaMask,
два профиля браузера.

## Что проверено на мейннете, а что нет

Проверено живыми деньгами 2026-08-31, весь вход целиком:

| шаг | результат |
| --- | --- |
| мост Base → Starknet | 2 USDC доехали, доставку оплатил релеер |
| создание аккаунта | задеплоен, 0.97 STRK с релеера |
| **своп без газа** | 1 USDC → 38.97 STRK при **нулевом** STRK |
| активация приватности | зарегистрирован в пуле |

**Не проверено на мейннете: анонимный приёмный аккаунт `B`.** Это ровно то, о
чём говорится в пункте 3 сценария. Прогнать один раз **до** записи — платит
релеер, около 10 STRK. Если упадёт, пункт 3 переписать под «QR публикует адрес
этого аккаунта» и не заявлять несвязанность.

## Что подготовить

**Два профиля браузера, два MetaMask.**

**Автор.** Достаточно активированного аккаунта; для приёма ему не нужно ничего.
Подойдёт `0x06c90d9b…` — 6.35 STRK, приватность включена.

**Донатер.** Ему нужен **приватный** USDC, то есть после активации он должен
ещё зашилдить. Подойдёт `0x031460…` — 28.45 STRK и 0.91 USDC публичных.
Шилд стоит 6 STRK комиссии плюс газ, около 11 всего.

**Шилдить сильно заранее.** Свежие ноты не тратятся, пока пруф-блок их не
увидит, — это около десяти блоков.

**Донатить на свежий QR**, которому этот кошелёк ещё не платил. Релеится только
первый перевод новому получателю, и без этого главного кадра не будет.

**Релеер.** 33.11 STRK. Расход за съёмку: `B` около 10, релеенный донат около
9. На один дубль хватает, на три — нет. Проверить до записи.

Вкладки открыть заранее: приложение в двух профилях, Voyager.

## Чего нельзя обещать

- **«MetaMask теперь работает в Starknet»** — неверно. Это не Starknet Snap,
  MetaMask ничего не знает про STRK20. Мы задекларировали класс аккаунта,
  который проверяет его EIP-712-подпись.
- **«Мы единственные, кто прячет отправителя»** — на Ready X обычный перевод и
  так уходит с их пеймастера. Наш релей незаменим там, где пеймастера нет.
- Про цену говорить цифрами, а не прилагательными: весь круг — активация,
  шилд, приватный перевод, вывод и отправка на биржу — стоил **23 STRK, около
  60 центов** по котировке AVNU на 31 августа.
- Не показывать в кадре адреса и ссылки, которые не готов сделать публичными:
  QR-ссылка публикует принимающий адрес.

## Последовательность

Кульминация в середине, а не в конце: кадр с эксплорером — единственное, чего
не делает никто вокруг, и закапывать его после обзора фич значит потратить
впустую.

### 1. Хук (~20 сек)

Показать готовую донатную ссылку. Автор публикует один QR, кто угодно донатит,
и в блокчейне не остаётся ни адреса донатера, ни суммы. Дальше — как это
выглядит вживую, на мейннете, с настоящими деньгами.

Не начинать с архитектуры. Начать с того, что человек получит.

### 2. Автор подключается: MetaMask и больше ничего (~60 сек)

Главный сюрприз демо, поэтому идёт вторым.

Подключить MetaMask на My QR. Приложение **само перебрасывает на экран входа**,
если аккаунт ещё не готов — показать этот момент, он и есть продукт: один
экран, четыре шага, у каждого написано, кто платит.

Проговорить:

- **никакого нового сида, никакого второго кошелька, никакого Snap** —
  старкнет-аккаунт выводится из эфирного адреса, MetaMask подписывает EIP-712;
- **в Ethereum не уходит ни одной транзакции**, подпись бесплатна, эфирных
  комиссий нет вообще;
- **аккаунт некастодиальный, и второго ключа не существует** — у него нет
  своего ключа, он принимает только то, что подписал твой MetaMask.

Если аккаунт автора уже активирован, экран это увидит и покажет пройденные
шаги галочками — так даже нагляднее: видно всю дорогу и видно, что она позади.

### 3. Автор создаёт QR (~50 сек)

My QR, донатная ссылка с пустой суммой, скачать PNG.

Сказать главное: **на QR стоит не адрес моего кошелька.** Приложение выводит
отдельный приёмный аккаунт, а деплоит и регистрирует его наш релеер — поэтому
основной кошелёк автора с этой ссылкой публично не связан. Если бы за это
платил сам автор, связка бы и появилась.

Сумма на QR не появляется никогда — её выбирает поддерживающий.

*Если предварительный прогон `B` не прошёл — этот абзац заменить на «QR
публикует адрес этого аккаунта» и про несвязанность не говорить.*

### 4. Донатер: второй MetaMask, весь путь с нуля (~90 сек, из них ~30 пруф)

Второй профиль. Здесь показывается вход целиком, потому что он и есть новое:
человек приходит с USDC на Base и **ни разу не покупает STRK руками**.

- мост с Base — доставку на Starknet оплачиваем мы;
- создание аккаунта — тоже мы, около цента;
- **покупка STRK за USDC без газа** — у аккаунта ноль STRK, поэтому своп
  оплачивает сам себя: AVNU отправляет транзакцию и берёт своё из USDC;
- активация приватности — вот здесь платит уже пользователь.

Дальше открыть ссылку автора, выбрать сумму, подтвердить. Пока строится
доказательство — рассказать, что происходит: транзакция доказывается локально,
пул проверяет доказательство, а не подпись отправителя. Именно поэтому её может
отправить кто угодно — и этим сейчас воспользуемся.

### 5. Кульминация: эксплорер (~60 сек)

Открыть транзакцию и показать пальцем:

- **отправитель — релеер MorokPay**, а не кошелёк донатера;
- адреса донатера нет в calldata;
- суммы нет в событиях.

Сказать про релей прямо: первый перевод новому получателю — единственный,
который выдал бы связку, потому что он открывает канал и пишет адрес
получателя в открытую. Именно этот перевод MorokPay отправляет от себя и
оплачивает сам. Все последующие донаты тому же автору канала не открывают и
уходят обычным путём.

Не торопиться. Это самое сильное место видео.

### 6. Обратно к автору (~30 сек)

Приватный баланс вырос. В блокчейне суммы нет, отправителя нет.

### 7. Это полноценный приватный кошелёк (~60 сек)

Показать карточку балансов и назвать вещи своими именами:

- **Shield** — завести публичный USDC в приватность;
- **Send privately** — приватный перевод на любой адрес, не только по QR;
- **Unshield** — вернуть в публичный баланс;
- **Send** — отправить наружу, на биржу.

То есть MetaMask здесь не «ещё один способ подключиться», а полноценный
приватный кошелёк Starknet, которого у пользователя до этого не было.

**Что сказать голосом про карточку, пока она в кадре.** Балансы сгруппированы
так, как их видит человек, а не так, как устроены мы: **Public** одной суммой —
и то, что лежит на Base, и то, что на Starknet, — и отдельно **Private**.
Промежуточный публичный баланс на Starknet это наша механика, а не его
категория.

Дальше сказать, куда это идёт: **следующий шаг — одна кнопка «сделать
приватным» прямо на строке Base**, которая делает мост и шилд за раз, и
промежуточного Starknet-баланса человек не видит вообще.

Не говорить «уже работает» — не работает. Честная формулировка: почему это не
просто две вызванные подряд функции. Мост оплачиваем мы, около 1 STRK. Шилд
платит пользователь — 11.31 STRK на один USDC, из них 6 комиссия пула. Значит
тот, кто пришёл с Base без STRK, цепочку физически не закончит, и для него
настоящий порядок — мост, покупка STRK, шилд, то есть тот самый экран входа.
Кнопка имеет смысл только там, где STRK уже есть. Подробности в
[roadmap.md](roadmap.md), пункт 8.

### 8. Круг замкнут: с биржи и на биржу (~30 сек)

Весь путь пройден на мейннете живыми деньгами: завели USDC, зашилдили,
отправили приватно, вывели и **отправили на Binance — дошло**.

### 9. Монетизация и честные границы (~40 сек)

- Комиссия MorokPay планируется на **шаге вывода**, а не с каждого доната.
  Донат приходит автору целиком.
- Пул STRK20 берёт свою фиксированную комиссию за операцию в STRK — это не
  наши деньги.
- **Получать донаты автору не стоит ничего.** Платит отправитель, а первый
  перевод оплачиваем мы.

### 10. Финал (~20 сек)

Ссылка на приложение. Открыто и работает на мейннете прямо сейчас.

## Английская версия

Готовый текст ниже, в разделе **English cut**. Заметки ниже относятся к расширению донатной
версии и в снятый вариант не вошли.

Снимать после русской, тем же порядком. Что стоит добавить, если решишь
расширять: пункт 5 усилить вторым окном с транзакцией *нерелеенного* первого
перевода — видно, как выглядит та же операция, когда связку никто не разрывает.
Такой пример есть на Sepolia.

Второй вариант усиления — начать с того, чем заканчивается пункт 2: аккаунт на
Starknet, который валидирует эфирную подпись. Для англоязычной аудитории это
самостоятельно интересная вещь, и она попадает в разговор про нативный account
abstraction, который сейчас идёт в экосистеме.

---

# English cut — spoken text

Written to be read aloud, in four takes so any one of them can be redone
without the others. Numbers measured 2026-09-07 unless marked; reprice before
publishing if more than a week passes.

## Intro — talking head, no screen (~30 s)

> Hi, I'm Sergei. I built MorokPay.
>
> We ran a giveaway on Starknet. Sending the money privately was the easy part.
> Receiving it was not. People had to install a Starknet wallet, write down
> another seed phrase, and find a gas token. Out of everyone we tried to pay,
> four people made it through.
>
> So we stopped asking them to change wallets, and built for the one they
> already had.
>
> MorokPay is a privacy layer on top of STRK20, Starknet's privacy pool. Anyone
> with an Ethereum wallet can send private USDC and take private donations —
> no new wallet, no gas token.
>
> Today it runs on Base. Any chain Circle's CCTP reaches works the same way:
> the privacy layer never sees which chain the money came from.
>
> Everything you're about to see is on mainnet, with real money.

**The four is the whole argument** - a real number from a real giveaway, and
more persuasive than any adjective about friction. Be sure of it before saying
it on camera; it is a public claim about your own campaign.

**On CCTP.** "Runs on any chain CCTP reaches" is a claim about the design, not
about what is deployed, and it is true for a specific reason worth knowing if
asked: CCTP delivers native USDC to Starknet whatever chain it was burned on,
so the privacy layer is downstream of the difference. Adding a chain is a
config table, a chain picker, and a live run - not a redesign. Do not let it
slide into "we support every chain" in the present tense.

## Part 1 — getting in (~2 min)

**[Landing page, nothing connected]**

> This is MorokPay. It sends private USDC on Starknet — to anyone who has an
> Ethereum wallet.
>
> I'm going to send some. First I have to get set up. Watch how much Starknet
> knowledge this takes: none.

**[Connect EVM wallet, MetaMask popup]**

> This is MetaMask. Not a Starknet wallet. MetaMask.
>
> I have three dollars of USDC on Base, and a little ETH for gas. That's
> everything I own here.

**[/start, point at the derived address]**

> And this is my Starknet account.
>
> I didn't create it. No new seed phrase, no second wallet to install, no Snap.
> It's derived from my Ethereum address, and it only accepts what my MetaMask
> signs. MorokPay holds no key to it.

**[Step 1, bridge]**

> Four steps. Each one tells you who pays for it.
>
> First, get the USDC onto Starknet. This is Circle's CCTP — burned on Base,
> minted on Starknet. MorokPay pays to deliver it.

**[Step 2, create account]**

> Second, create the account. I sign a message. That's free, and nothing is
> sent to Ethereum. MorokPay deploys it and pays the gas — about one STRK,
> three cents.

**[Step 3, buy STRK]**

> Third, I need STRK for the last step. I have zero STRK.
>
> So the swap pays for itself. AVNU takes its gas out of the USDC I'm selling.
> One dollar buys about thirty-two STRK.
>
> That's the part people don't expect: your first Starknet transaction, holding
> no Starknet gas at all.

**[Step 4, activate]**

> Fourth, activate privacy. This one I pay for — a one-time registration with
> the STRK20 pool. Around ten STRK, about thirty cents.
>
> This one can't be sponsored. It carries a proof that my own account has to
> submit.

**[Done state]**

> And that's it. From an Ethereum wallet and nothing else.
>
> One more thing before I can send. This USDC is still public — anyone can see
> it. I need to move it into the pool. That's a shield, and it takes about ten
> blocks to settle. I'll start that now, and pick it up in the next part.
>
> And keep this in mind for part three: everything you just watched is the
> **sender's** setup. The person receiving the money does none of it.

## Part 2 — sending (~2 min)

**[Balances card]**

> Picking up where I left off. My account is set up, and I have about a dollar
> ninety of USDC on Starknet. But it's public — sitting in the open, anyone can
> look it up.
>
> So first I shield it. That moves it into the STRK20 pool. From here on, what
> I do with it doesn't show up on the ledger.
>
> This one costs me. About eleven STRK, thirty-five cents — six of that is the
> pool's own fee, not ours.

**[Shield USDC, MetaMask popup]**

> And look at what signing this takes. It's MetaMask. It's a signature. There's
> no Starknet wallet anywhere in this.

**[cut over the wait]**

> Fresh deposits need about ten blocks before the pool will let them move.
> That's done.

**[/stash]**

> Now, sending. Two ways: a one-time link anyone can open, or straight to a
> specific wallet. I'll do the second — it's the more interesting one.

**[Pay a MetaMask tab, paste the recipient address]**

> This is a different wallet. It's Phantom, not MetaMask — and it holds nothing
> on Starknet. No account, no STRK, nothing. Just an Ethereum address.
>
> I paste it in, and MorokPay works out which Starknet account that address
> controls. That account doesn't exist yet. It doesn't need to.

**[Amount, expiry]**

> One dollar. And a deadline — after it, if nobody has collected, I can take it
> back. Collecting never stops working; the deadline only opens a door for me.

**[Recovery file]**

> This is my recovery file. It's the only way I could reclaim this, it's mine
> alone, and it never goes anywhere near the recipient.

**[Park, then the receipt]**

> ...and it's parked.
>
> Here's the part I like. **I have nothing to send them.** No link, no code, no
> message. The money is addressed to their wallet. They open the app, connect,
> and it's there.
>
> That's part three.

## Part 3 — collecting, and the close (~75 s)

**[Phantom, the claim lands]**

> That's it. That wallet had nothing on Starknet a minute ago — no account, no
> STRK, no gas. It signed once, and the money is there.
>
> And nobody sent it a link. Nobody sent it anything at all.

**[Why it is possible]**

> The reason this works is account abstraction, and on Starknet it's native —
> not a bolt-on.
>
> That Starknet account is a contract, and its rule is simple: accept whatever
> this one Ethereum address has signed. So MetaMask, Phantom, any EVM wallet
> becomes a Starknet account without knowing Starknet exists. No new seed
> phrase. No snap. No bridge the user has to trust.
>
> We're using it for privacy. But that's the general shape of it — account
> abstraction is what lets a privacy pool take users from a chain it isn't even
> on.

**[Where the money comes from]**

> This USDC came from Base. It didn't have to. CCTP is Circle's own rail and it
> reaches most of the major chains — same window, same flow.
>
> We've wired Base, because one chain done properly beats five half-tested.
> Adding the next one is a config table and a live run, not a redesign.

**[Money]**

> So — does anyone actually pay for this?
>
> The closest comparison is Privacy Cash on Solana. Same idea, different chain,
> and their numbers are public on DefiLlama: about eighty-three thousand
> dollars in thirty days, over a million all time, on roughly a hundred and
> twenty million of private transfers in their first hundred days. Deposits
> free, and they take zero point three five percent on the way out plus a flat
> relay charge.
>
> So the demand isn't theoretical. People pay for this.
>
> Our costs are shaped differently. Starknet charges a flat six STRK per pool
> operation, so what a transfer costs us barely moves with its size. That makes
> a percentage the wrong instrument for us — we charge a flat fee instead.
>
> And that cuts both ways, so I'll say both. Below about a hundred dollars we
> are the expensive option: their percentage is small on a small transfer, and
> our flat cost is not. Above it we're cheaper, and the gap only widens. A ten
> thousand dollar transfer costs a dollar fifty-seven with us, against
> thirty-five dollars with them. Twenty-three times.
>
> So the plan isn't to beat them everywhere. It's a flat fee at the deposit, a
> minimum transfer size, and everything under it served on the cheap public
> path.

**[Close]**

> Private USDC on Starknet, for anyone holding an Ethereum wallet. Live on
> mainnet — and everything you just watched was real money.

## Lines to keep, and lines not to say

**Keep the admission that we are the expensive option below about a hundred
dollars.** The temptation is to cut it. It is what makes the rest of the
numbers land: naming your own weak zone is what buys trust in the strong one.
It is also simply true — our costs are flat and theirs are proportional.

**Do not say "USDC from any chain" in the present tense.** One route is wired.
The architecture claim is fine and true; the deployment claim is not.

**Do not call it "a MorokPay account".** It sounds custodial, and it is the
opposite: derived from the user's Ethereum address, accepting only what their
wallet signed, with no key held here.

**Do not say onboarding will be invisible in production.** Steps two through
four can collapse into one click, but the bridge is always the user's own
transaction, and pool registration carries a proof that cannot be relayed — it
stays their signature and their money. The stronger true line is that the
*recipient* has no onboarding at all.

**Do not say "MetaMask now works on Starknet".** MetaMask knows nothing about
STRK20. An account class validates its EIP-712 signature.

**Privacy Cash figures are from DefiLlama on 2026-09-03.** Re-check before
publishing; they climb.

Every number here is sourced from [who-pays.md](who-pays.md) and the cost
section of [evm-escrow-invoices.md](evm-escrow-invoices.md).
