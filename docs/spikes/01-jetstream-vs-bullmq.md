# Спайк 01. NATS JetStream проти BullMQ

- Дата: 2026-10-08
- Код: [`spikes/01-jetstream-vs-bullmq`](../../spikes/01-jetstream-vs-bullmq) (одноразовий, не частина workspace)
- Стек: NATS 2.10 (`-js`), MinIO (`pgsty/minio`), Redis 7, `@nats-io/jetstream` 3.x, BullMQ 5.x, sharp 0.33
- Мета: отримати власний досвід роботи з чергою перед ADR-002, а не писати ADR «з документації».

## Як повторити

```bash
cd spikes/01-jetstream-vs-bullmq
npm install
docker compose up -d
node seed.mjs                    # тестова картинка 3000x2000 у s3://spike/sources/test.jpg
node js-advisories.mjs &         # слухати $JS.EVENT.ADVISORY.CONSUMER.>
node js-producer.mjs             # опублікувати { jobId, imageUrl, preset }
node js-consumer.mjs             # pull consumer: download -> sharp -> MinIO -> ack
node js-info.mjs                 # стан стріму і консюмера; `node js-info.mjs reset` видаляє стрім
```

Ручки консюмера через env: `ACK_WAIT_MS`, `MAX_DELIVER`, `NO_ACK=1`, `SLOW_MS`, `HEARTBEAT=1`,
`NAK=1 NAK_DELAY_MS`, `TERM_MSG=1`, `NAME`. Для BullMQ: `bull-producer.mjs` / `bull-consumer.mjs`
з `SLOW_MS`, `FAIL=1`, `LOCK_MS`, `STALLED_INTERVAL_MS`, `MAX_STALLED`, `JOB_ID`.

Redis у спайку слухає `6380`, бо `6379` на машині зайнятий іншим проєктом.

## JetStream: що спостерігав

Стрім `SPIKE_JOBS`, subject `spike.resize`, retention `WorkQueue`, `duplicate_window = 120s`.
Durable pull consumer `resize-worker`, `AckPolicy.Explicit`, `max_ack_pending = 10`.

### E1. Щасливий шлях

Повідомлення взяте, ресайз 3000px -> 800px WebP за ~37 мс, `ackAck()` повернув `true`.
Після ack у стрімі `messages: 0`: WorkQueue видаляє повідомлення, щойно воно підтверджене.

### E2. Без ack, `AckWait = 3s`, `MaxDeliver = 3`

```
22:08:29.358 got attempt=1/3 redelivered=false   -> resized, NO ACK
22:08:32.360 got attempt=2/3 redelivered=true    -> resized, NO ACK
22:08:35.362 got attempt=3/3 redelivered=true    -> resized, NO ACK
22:08:38.367 [advisory] MAX_DELIVERIES stream_seq=2 deliveries=3
stream_messages: 1
```

- Повторна доставка йде рівно через `AckWait` після попередньої.
- Робота (ресайз і запис у S3) виконалась **тричі**. Видимого дубля немає лише тому, що ключ
  детермінований (`results/{jobId}/{preset}.webp`) і перезаписується.
- Після вичерпання `MaxDeliver` повідомлення **лишається в стрімі** назавжди і більше нікому не
  доставляється. Сервер лише шле advisory `MAX_DELIVERIES`. DLQ треба будувати самому:
  слухати advisory, копіювати повідомлення в `JOBS_DLQ` і видаляти з робочого стріму.

### E3. `kill -9` консюмера посеред обробки

```
22:08:54.218 [A] got attempt=1/3
22:08:56     >>> kill -9 A
22:08:56.246 [B] consumer ready
22:08:59.222 [B] got attempt=2/3 redelivered=true   (рівно 5s = AckWait після першої доставки)
22:08:59.283 [B] ACK
```

Задача не загубилась. Час відновлення визначає `AckWait`, а не момент смерті процесу: великий
`AckWait` дає довге відновлення, малий дає дублі для довгих задач (див. E4).

### E4. Обробка довша за `AckWait`

`SLOW_MS = 7000`, `AckWait = 3000`, два консюмери A і B.

Без heartbeat:

```
22:09:13.637 [A] got attempt=1/3
22:09:16.641 [B] got attempt=2/3 redelivered=true   <- A ще працює
22:09:20.685 [A] ACK confirmed=true                 <- пізній ack прийнятий
22:09:23.709 [B] ACK confirmed=true
```

Дві копії задачі виконувались **паралельно**, і обидва ack пройшли. Це головний аргумент на
користь inbox/ідемпотентності у воркерах (Етап 3): at-least-once означає не лише «повтор після
падіння», а й «паралельний дубль живого воркера».

З `HEARTBEAT=1` (`msg.working()` щосекунди): лише A, жодної повторної доставки.
Для `video.transcode` (хвилини кодування) heartbeat обов'язковий.

### E5. `nak(delay)`, `term()`, дедуп

- `nak(2000)`: повтор рівно через 2 с, advisory `MSG_NAKED` на кожен nak. Після третього nak
  знову `MAX_DELIVERIES`, повідомлення лишається в стрімі. `nak(delay)` дає основу для backoff
  з jitter на рівні воркера (затримку рахуємо самі).
- `term(reason)`: жодної повторної доставки, advisory `MSG_TERMINATED` з причиною. У WorkQueue
  повідомлення після `term` видаляється (`messages: 0`). Підходить для permanent-помилок, але
  перед `term` треба самому покласти копію в DLQ, інакше дані втрачено.
- Три `publish` з однаковим `Nats-Msg-Id = job-42`: перший `duplicate=false`, далі
  `duplicate=true`, у стрімі одне повідомлення. Дедуп лише в межах `duplicate_window`.

## BullMQ: що спостерігав

Черга `spike-resize`, `attempts: 3`, `backoff: exponential 1s`, `concurrency: 1`.

### B1. `kill -9` посеред обробки (`lockDuration = 5s`, `stalledInterval = 5s`)

```
22:10:25.097 [A] got attemptsMade=0
22:10:27     >>> kill -9 A
22:10:37.143 [B] stalled job=bull-kill
22:10:37.145 [B] got attemptsMade=0 stalledCounter=1
22:10:37.200 [B] completed
```

Відновлення ~10 с (закінчення lock плюс наступна перевірка stalled). Stall не рахується як
спроба (`attemptsMade` лишився 0), для нього окремий ліміт `maxStalledCount`; при перевищенні
задача йде у `failed`.

### B2. Помилка тричі

Повтори через ~1 с і ~2 с (exponential backoff з коробки), після 3-ї спроби задача в `failed`
з повідомленням помилки. `failed` фактично працює як вбудована DLQ, retry робиться через API.

### B3. Дедуп

Три `add()` з однаковим `jobId`: у черзі одна задача. Але `add()` **не повідомляє**, що це
дубль: повертає той самий job без прапорця, на відміну від `duplicate=true` у JetStream.

## Порівняння (власні спостереження)

| Аспект                 | JetStream                                            | BullMQ                                                |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Повтор після падіння   | через `AckWait`                                      | через `lockDuration` + `stalledInterval`              |
| Довгі задачі           | `msg.working()` вручну                               | lock продовжується автоматично, поки живий event loop |
| Backoff                | сам рахуєш, `nak(delay)`                             | вбудований (fixed, exponential, custom)               |
| DLQ                    | немає, будується на advisories або в коді воркера    | стан `failed` з коробки                               |
| Дедуп продюсера        | `Nats-Msg-Id` з явним `duplicate=true`               | `jobId`, мовчки                                       |
| Персистентність        | файловий стор, реплікація в кластері (RAFT)          | Redis (AOF/RDB), без кворумної реплікації             |
| Мультимовність         | клієнти для багатьох мов                             | лише Node                                             |
| Метрика для автоскейлу | `num_pending` консюмера, є KEDA scaler               | довжина списків у Redis, є KEDA scaler для Redis      |
| Окремі класи задач     | стріми і консюмери з власними лімітами               | окремі черги                                          |
| Поріг входу            | вищий: streams, consumers, ack-семантика, advisories | нижчий: черга і воркер                                |

## Висновки для ADR-002

1. Обидві системи дають at-least-once. «Exactly-once» не дає жодна, тому ідемпотентність
   воркера (inbox, детерміновані ключі результатів) потрібна незалежно від вибору.
2. JetStream вимагає більше власного коду (DLQ, backoff, heartbeat), але кожен механізм
   явний і контрольований. Для PDP, де треба показати розуміння надійності, це плюс.
3. BullMQ швидший на старті, але прив'язує до Redis, який у проєкті вже має роль rate limiter'а.
   Змішувати черги і rate limiting на одному Redis означає спільну точку відмови.
4. Довгі відео-задачі: JetStream з `msg.working()` і явним `AckWait` легше пояснити і перевірити
   chaos-тестом, ніж неявне продовження lock у BullMQ.
5. Для DLQ потрібен окремий стрім `JOBS_DLQ`. Воркер сам пише туди перед `term()` (permanent)
   і перед останньою спробою (transient), не покладаючись на advisory як на єдине джерело.

## Що лишилось перевірити пізніше

- Поведінку при рестарті NATS-сервера з файловим стором (персистентність незакритих повідомлень).
- `max_ack_pending` як backpressure під навантаженням (Етап 2).
- Пізній ack від «мертвої» доставки: чи можна його відхилити (зараз сервер приймає).
