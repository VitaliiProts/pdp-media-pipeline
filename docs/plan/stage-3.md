# Етап 3. Надійність, `video.frames` і вебхуки

- Тижні 8–10: 30 листопада – 20 грудня 2026
- Статус: в роботі (3a готовий, 3b попереду). Етап розбито на два PR:
  - **3a «Надійність»**, гілка `feature/stage-3a-reliability`;
  - **3b «`video.frames`, завантаження за URL і вебхуки»**, після мерджу 3a.

## Результат і критерій

**Результат:** жодна задача не губиться і не виконується двічі з видимим ефектом, навіть якщо
вбити воркер чи Postgres посеред роботи. З'являються витяг кадрів із відео, завантаження джерела
за URL і вебхуки про завершення.

**Готово, коли:**

- тест «вбити воркер посеред обробки» не дає втрат і подвійних результатів;
- повторний `POST /jobs` з тим самим ключем не створює нової задачі;
- вебхук на «поганий» приймач доходить після ретраїв або коректно потрапляє в DLQ.

## Що вже є з Етапу 1

- Outbox: job і подія в одній транзакції, relay з `FOR UPDATE SKIP LOCKED`, `Nats-Msg-Id = eventId`.
- Дедуп у JetStream: duplicate window 2 хв, dispatch публікується з `Nats-Msg-Id = dispatch:<jobId>`.
- Ідемпотентні переходи статусів за `(jobId, attempt, to)` у `job_transitions`.
- Покинуті спроби: нова спроба закриває попередню відкриту з `outcome = abandoned`.

## Прийняті рішення

| Питання             | Рішення                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failed` чи `dead`  | Permanent-помилка й вичерпані ретраї дають `dead` з `dead_reason` (`permanent` / `exhausted`) і запис у `JOBS_DLQ`; `failed` більше не ставиться                           |
| Хто рахує спроби    | Metadata, за кількістю `job_executions` поточного покоління; `max_deliver` консюмера необмежений, бо падіння Metadata не повинно вбивати задачі                            |
| Номер спроби        | `attempt = attemptBase + deliveryCount`; `attemptBase` росте при redrive, тож номери не перетинаються між поколіннями                                                      |
| Затримка ретраю     | `nak(delay)`, exponential backoff з full jitter: `random(0, min(cap, base × 2^(n−1)))`                                                                                     |
| Inbox               | Таблиця `inbox (consumer, message_id)` у Metadata, пишеться в одній транзакції з фінальним переходом; повторна доставка → `DUPLICATE_DELIVERY`                             |
| DLQ                 | Стрім `JOBS_DLQ` (`dlq.>`, retention limits, 14 днів); запис іде через outbox у тій самій транзакції, що й перехід у `dead`                                                |
| Redrive             | `POST /v1/jobs/:id/redrive`: `dead → queued`, нове покоління з новим `Nats-Msg-Id` для dispatch                                                                            |
| Idempotency-Key     | Таблиця `idempotency_keys (user_id, key)` у Metadata, `pg_try_advisory_xact_lock` на час створення: зайнятий ключ → `409`, інше тіло → `422`, повтор → збережена відповідь |
| Метрики             | `prom-client`, `/metrics` у metadata, scheduler і worker; на Етапі 4 переходимо на OTel                                                                                    |
| Вебхуки (3b)        | Задача типу `webhook.deliver` класу `io`: ретраї, DLQ і redrive ті самі; заголовки за специфікацією Standard Webhooks                                                      |
| `video.frames` (3b) | Окремий сервіс `apps/video-worker` з ffmpeg у власному образі                                                                                                              |

## Задачі

### 3a. Надійність

- [x] Контракти: ціль переходу `dead`, `attemptBase` у `job.created` і dispatch, запис DLQ, коди помилок.
- [x] Міграція: `inbox`, `idempotency_keys`, `jobs.attempt_base`, `jobs.dead_reason`.
- [x] Машина станів: `dead`, вичерпання спроб за `job_executions` поточного покоління, redrive.
- [x] Inbox у транзакції з фінальним переходом, `DUPLICATE_DELIVERY` на повторну доставку.
- [x] Класифікація помилок воркера: transient (таймаут, 5xx, мережа) → ретрай, permanent → `dead`.
- [x] Ретраї з full jitter, `JOB_MAX_ATTEMPTS = 5`.
- [x] `JOBS_DLQ`, `dead_reason`, redrive через Metadata і Gateway.
- [x] `Idempotency-Key` у `POST /v1/jobs`: `409` / `422` / повтор, очищення ключів старших за 24 год.
- [x] Метрики: `jobs_duplicates_total`, `jobs_dlq_total`, `jobs_retries_total`.
- [x] Web UI: `Idempotency-Key` при створенні задачі, `dead` з причиною, кнопка Redrive.
- [x] Інтеграційні тести: втрачений ack після успіху, crash loop, permanent → DLQ, transient → exhausted → redrive, Idempotency-Key.
- [x] ADR-006 «Ідемпотентність і семантика доставки», ADR-007 «Стратегія ретраїв і DLQ».

### 3b. `video.frames`, завантаження за URL, вебхуки

- [ ] `apps/video-worker`: ffprobe (тривалість до 60 с, кодек), кадр-превʼю і кадри з інтервалом, таймаут і `SIGKILL`.
- [ ] Завантаження джерела за URL: лише http(s), заборона приватних IP після DNS-резолву, ліміт розміру, таймаут, ліміт на хост.
- [ ] Вебхуки: реєстрація URL, підпис HMAC, `Webhook-Id`, доставка як `webhook.deliver` з ретраями й DLQ.
- [ ] Тестовий приймач вебхуків у compose: `500`, повільна відповідь, обрив з'єднання.
- [ ] Web UI: налаштування вебхука і перегляд доставок.
