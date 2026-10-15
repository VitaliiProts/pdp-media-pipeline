# Vitalii Prots | PDP: прогрес

Стан на 15 жовтня 2026. Структура — з PDP у Notion; детальний план з датами — PDF
«PDP Media Pipeline — покроковий план реалізації» і [плани етапів](plan/).

- `[x]` — виконано (посилання — де це видно)
- `[ ]` **в процесі** — почато, але критерій ще не виконано
- `[ ]` — ще не почато

## Middle/Senior software engineer

**Мета** цього PDP — розвиток інженера від Middle до рівня Senior Software Engineer через практичну
розробку продакшн сервісу для обробки фонових задач.

**Фокус**: hard-skills — архітектура, надійність, масштабування, тестування, CI/CD та
спостережуваність.

**Результат:** інженер не тільки реалізує окремі фічі, а й доведе здатність проєктувати, будувати
та підтримувати складний кластерний сервіс із повним життєвим циклом (від ADR до продакшн-релізів
та автоскейлу).

Сервіс: **PDP Media Pipeline** — ресайз картинок, кадри й транскодинг відео з вебхуками про
завершення ([README](../README.md), [ADR-001](adr/0001-domain.md)).

---

## Цілі PDP

- [x] **Архітектура:** спроєктувати сервіси з API, чергами та воркерами. Gateway, Metadata,
      Scheduler і воркери через NATS JetStream, 15 ADR ([docs/adr](adr/README.md)).
- [ ] **Надійність** — **в процесі**: ідемпотентність, ретраї з DLQ, fault tolerance.
  - [x] ідемпотентність, outbox та inbox, ретраї з jitter, DLQ і redrive
        ([ADR-006](adr/0006-idempotency-and-delivery.md), [ADR-007](adr/0007-retries-and-dlq.md));
  - [x] rollout і зупинка пода не губять задач ([ADR-012](adr/0012-autoscaling-and-graceful-shutdown.md));
  - [ ] fault tolerance під chaos-сценаріями (pod kill, затримки, OOM) — Етап 6.
- [ ] **Продуктивність** — **в процесі**: скейл (горизонтальний), контроль RPS і квот, стабільність
      під навантаженням.
  - [x] контроль RPS і квот, backpressure ([звіт Етапу 2](../perf/reports/stage-2.md));
  - [x] горизонтальний скейл воркерів за лагом черги, HPA gateway
        ([звіт Етапу 5](../perf/reports/stage-5.md));
  - [ ] 10k jobs/год при P95 < 2 хв, stress і soak — Етап 8.
- [ ] **Деплой:** CI/CD, canary і rollback — Етап 7. CI є, деплою в AWS ще немає (Етап 5b).
- [ ] **Метрики** — **в процесі**: SLO (наприклад, 99% jobs < 5 хв), DLQ < 1%, дублікати < 0.1‰,
      10k jobs/год при P95 < 2 хв.
  - [x] SLO, DLQ і дублікати вимірюються, burn-rate алерти ([ADR-010](adr/0010-observability.md));
  - [ ] дублікати < 0.1‰ і DLQ < 1%, доведені під збоями, — Етап 6;
  - [ ] 10k jobs/год при P95 < 2 хв — Етап 8.

---

## Технології, які треба опанувати

- [x] **Backend:** Node.js, TypeScript, NestJS.
- [x] **Черги:** NATS (JetStream), Redis + BullMQ. JetStream — у системі; BullMQ — у спайку для
      порівняння ([нотатки](spikes/01-jetstream-vs-bullmq.md), [ADR-002](adr/0002-queue.md));
      Redis — для rate limiting.
- [x] **БД:** PostgreSQL / Mongo. PostgreSQL з Drizzle і міграціями; Mongo — у порівнянні
      ([ADR-003](adr/0003-database.md)).
- [x] **Rate limiting:** GCRA у Redis одним Lua-скриптом, fail-open ([ADR-005](adr/0005-rate-limiting.md)).
- [x] **Observability:** OpenTelemetry, VictoriaMetrics, Grafana, VictoriaLogs і Pino, плюс Tempo
      для трейсів ([ADR-010](adr/0010-observability.md)).
- [ ] **Тести** — **в процесі**: Jest, Testcontainers, Pact, dependency-cruiser, clinic.js / 0x (optional).
  - [x] Jest (unit і Web UI), Testcontainers (інтеграційні з Postgres, NATS, Redis, MinIO),
        dependency-cruiser у CI;
  - [ ] Pact — Етап 6;
  - [ ] clinic.js і 0x — Етап 8.
- [ ] **DevOps** — **в процесі**: Docker, Helm, Kubernetes (HPA, PDB, readiness), Argo Rollouts,
      GitHub Actions.
  - [x] Docker (multi-stage, non-root), Helm (`pdp-lib`, umbrella, `values-dev`/`values-prod`),
        Kubernetes з HPA, KEDA, PDB, probes, GitHub Actions;
  - [ ] AWS, Terraform, деплой з CI — Етап 5b, [план](plan/stage-5b.md);
  - [ ] Argo Rollouts — Етап 7.
- [x] **Perf tools:** k6 (7 сценаріїв у `perf/k6`), autocannon.

---

## Сервіси для розробки

- [x] **API-Gateway** (REST/GraphQL): створення jobs, статуси, rate limiting. REST з OpenAPI
      (`/docs`); GraphQL свідомо не робили. Ще: presigned upload, вебхуки, backpressure.
- [x] **Worker Service:** обробка jobs. Замість PDF — медіа: `image.resize` (sharp),
      `video.frames` і `video.transcode` (ffmpeg, окремий сервіс), `webhook.deliver`.
- [x] **Metadata Service (PostgreSQL):** jobs, executions, audit, users. Плюс машина станів,
      outbox, inbox, idempotency keys, вебхуки.
- [x] **Scheduler:** розподіл jobs за класами (CPU / IO / priority).
- [x] **Observability Stack:** traces, metrics, logs, Grafana dashboards (Overview, SLO, Queues,
      Per-service, Job) як код.
- [ ] **CI/CD Pipeline** — **в процесі**: GitHub Actions, Helm deploy, Argo Rollouts.
  - [x] GitHub Actions: lint, typecheck, unit, інтеграційні, Helm, правила алертів, образи, Trivy і
        audit у режимі звіту;
  - [ ] Helm deploy з CI в AWS — Етап 5b;
  - [ ] Argo Rollouts — Етап 7.

---

## Вимоги

**API-Gateway**

- [x] ідемпотентність — `Idempotency-Key`: повтор повертає ту саму відповідь, інше тіло — `422`,
      паралельний повтор — `409`;
- [x] 20 rps на користувача, 200 rps глобально — частки `429` збігаються з розрахунком
      ([звіт Етапу 2](../perf/reports/stage-2.md));
- [x] `429` з `Retry-After` (і `RateLimit-*`);
- [x] P95 < 150 мс — 6.8 мс на `api-baseline`.

**Worker**

- [x] дедуп — inbox у Metadata, `Nats-Msg-Id`, детерміновані ключі результатів;
- [x] maxAttempts + jitter — 5 спроб, exponential backoff з full jitter;
- [ ] дублікати < 0.1‰ — **в процесі**: лічильник `jobs_duplicates_total` є, панель і методика
      підрахунку — Етап 6;
- [ ] DLQ < 1% — **в процесі**: метрика й алерт на частку DLQ є, перевірка під збоями — Етап 6.

**Metadata**

- [x] індексація — індекси під списки за користувачем і статусом, outbox, idempotency keys;
- [x] upsert — `ON CONFLICT DO NOTHING` для inbox і `job_executions`; унікальний ключ
      `(user_id, key)` для idempotency keys; перехід статусу, inbox і outbox — в одній транзакції.

**Observability**

- [x] SLO 99% jobs < 5 хв — для `image.resize`; для відео окремі пороги
      ([ADR-008](adr/0008-video-worker.md), [ADR-011](adr/0011-video-transcode.md));
- [x] latency, throughput, errors і queue depth на дашбордах.

**CI/CD**

- [ ] coverage ≥ 80% — **в процесі**: unit — 44.6% рядків, інтеграційні — близько 84% коду
      застосунків; блокувальний поріг — Етап 6;
- [ ] 0 critical у `npm audit` — **в процесі**: `pnpm audit` і Trivy в CI у режимі звіту,
      блокування — Етап 7;
- [ ] lead time < 30 хв — Етап 7;
- [ ] CFR < 15% — Етап 7.

---

## План виконання (етапи)

- [x] **Етап 0 — Ініціалізація:** каркас сервісів, Docker, Helm, ADR 001–004, CI.
- [x] **Етап 1 — MVP черг:** створення job → обробка → статус ([план](plan/stage-1.md)).
- [x] **Етап 2 — Rate limiting & Backpressure:** ліміти, навантажувальні тести
      ([план](plan/stage-2.md), [звіт](../perf/reports/stage-2.md)).
- [x] **Етап 3 — Надійність:** ідемпотентність, retries, DLQ; також `video.frames`, джерела за URL
      і вебхуки ([план](plan/stage-3.md)).
- [x] **Етап 4 —** OpenTelemetry, метрики, Grafana панель; SLO і burn-rate алерти
      ([план](plan/stage-4.md)).
- [x] **Етап 5 — Kubernetes & Autoscaling:** Helm, HPA, PDB, readiness; KEDA, graceful shutdown,
      `video.transcode` ([план](plan/stage-5.md), [звіт](../perf/reports/stage-5.md)).
- [ ] **Етап 5c — Акаунти, медіатека, новий UI і SSG** (нове, до 5b) — **в процесі**: вхід за
      email і паролем, каркас UI і дизайн-система, медіатека з оригіналами й версіями, пререндер
      публічних сторінок ([план](plan/stages-5c-5d.md#етап-5c-акаунти-медіатека-новий-ui-і-ssg-тижні-1619-25-січня--21-лютого),
      [звіт входу](../perf/reports/stage-5c.md)). Код 5c.1–5c.5 готовий, ADR 013–015; лишається
      злиття 5c.4–5c.5 і перевірка критерію в k3d.
- [ ] **Етап 5d — Переклад відео** (нове, до 5b): `video.dub` — розпізнавання, переклад і озвучка
      з тим самим таймлайном; UI з прогресом по кроках і транскриптом
      ([план](plan/stages-5c-5d.md#етап-5d-переклад-відео-тижні-2023-22-лютого--21-березня)).
- [ ] **Етап 5b — AWS, домен і перший деплой з CI** (є в PDF-плані, тепер після 5c і 5d) — план
      готовий ([план](plan/stage-5b.md)).
- [ ] **Етап 6 — Testing:** pod kill, delays, fault tolerance; coverage 80%, Pact.
- [ ] **Етап 7 — CI/CD Canary & Rollback:** GitHub Actions, Trivy, Argo Rollouts.
- [ ] **Етап 8 — Перформанс & Звіт:** k6 сценарії, bottlenecks, cost per 1k jobs.

---

## Трекінг результатів

- [x] **Checkpoint 1 (після Етапу 3):** базова надійність доведена (MVP jobs, квоти,
      ідемпотентність, DLQ). Матеріал для демо: Етапи 1–3, ADR 001–007.
- [ ] **Checkpoint 2 (після Етапу 6):** сервіс production-ready (чек логів).
- [ ] **Checkpoint 3 (після Етапу 8):** CI/CD.

---

## Фінальна прожарка

- [ ] **Архітектура** — **в процесі**: захист ADR, trade-offs, демонстрація графів.
  - [x] 15 ADR з альтернативами й trade-offs ([відповідність номерам PDF](adr/README.md#відповідність-номерам-pdf));
  - [x] графи: схема потоку в [README](../README.md), дашборди Grafana, графіки звітів;
  - [ ] ADR стратегії деплою і rollback (у PDF — ADR-009) — Етап 7;
  - [ ] C4-діаграми (Context і Container).
- [ ] **Якість:** coverage, contract, memory профайлінг — Етапи 6 і 8.
- [ ] **Продуктивність** — **в процесі**: k6 звіти, cost per 1k jobs, план оптимізацій.
  - [x] k6 звіти Етапів 2 і 5;
  - [ ] cost per 1k jobs і план оптимізацій — Етап 8.
- [ ] **Q&A:** відповіді на питання лідів, CTO, обговорення bottlenecks та подальшого roadmap.
