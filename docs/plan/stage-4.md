# Етап 4. Observability

- Тижні 11–12: 21 грудня 2026 – 3 січня 2027
- Статус: готово. Етап розбито на два PR:
  - **4a «Трейси і логи»**, гілка `feature/stage-4a-tracing-logs`;
  - **4b «Метрики, дашборди, SLO і алерти»**, після мерджу 4a.

## Результат і критерій

**Результат:** за будь-яким `jobId` за хвилину знаходиться повний трейс і всі логи, а SLO видно
на дашборді.

**Готово, коли:**

- у Grafana є всі метрики з вимог PDP: latency, throughput, errors, queue depth;
- трейс проходить через усі сервіси;
- з логу можна перейти до трейсу.

## Що вже є

- Pino через `nestjs-pino` у кожному сервісі, JSON у stdout, секрети в заголовках редагуються.
- `prom-client` і `/metrics` у metadata, scheduler, worker: `jobs_duplicates_total`,
  `jobs_dlq_total`, `jobs_retries_total`.
- Усі події проходять через одну функцію `enqueueEvent` (outbox), а всі консюмери — через
  `PullWorker` з `libs/messaging`.

## Прийняті рішення

| Питання                  | Рішення                                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK                      | OpenTelemetry Node SDK для всіх трьох сигналів; `prom-client` прибирається в 4b                                                                                                                    |
| Шлях даних               | Сервіси шлють OTLP (http/protobuf) в OTel Collector; Collector розносить: трейси в Tempo, логи у VictoriaLogs, метрики у VictoriaMetrics                                                           |
| Трейси                   | Grafana Tempo 2.10 (monolithic, локальне сховище); пошук TraceQL за `job.id`                                                                                                                       |
| Логи                     | Pino → `instrumentation-pino` (log sending) → OTLP → VictoriaLogs; stdout лишається для `docker logs`. У кожному рядку `trace_id`, `span_id`, а в межах задачі ще й `job_id`                       |
| Старт SDK                | Першим імпортом у `main.ts` (`import './telemetry'`), до Nest, pino, pg і http; інтеграційні тести SDK не стартують, API лишається no-op                                                           |
| Контекст через NATS      | W3C `traceparent`, `tracestate` і `baggage` у заголовках повідомлення: inject у `publishJson`, extract у `PullWorker`; span'и `PRODUCER` / `CONSUMER` за semconv messaging                         |
| Контекст через outbox    | Колонка `outbox.trace_context` (carrier) пишеться в `enqueueEvent` з активного контексту; relay публікує кожен рядок у span'і з цим батьком. Так `POST /jobs` і вся обробка — один трейс           |
| `job.id` у всіх сигналах | Baggage `job.id`, `job.type`, `job.class` ставиться там, де задача стає відомою (створення в Metadata, консюмери). `BaggageSpanProcessor` копіює його в атрибути span'ів, pino mixin — у логи      |
| Шум                      | Без span'ів на `/health` і `/metrics`; `pg`, `ioredis` і `undici` лише всередині наявного трейсу, тож опитування outbox і readiness не дають кореневих трейсів; `fs`, `dns`, `net` вимкнені        |
| Вихідні запити egress    | Власний span `CLIENT` без query-рядка URL; сам запит іде з `suppressTracing`, тож `traceparent` і `baggage` не витікають на чужі хости (джерела за URL, вебхуки)                                   |
| Ручні span'и             | `job <type>` у `JobRunner`, sharp на кожен пресет, ffprobe і ffmpeg, завантаження джерела, доставка вебхука; S3, pg, HTTP — auto-instrumentation                                                   |
| Перехід з UI до трейсу   | `jobs.trace_id` пишеться при створенні; `GET /v1/jobs/:id` повертає `traceId`; картка в Web UI веде на дашборд Grafana «Job» з трейсом і логами задачі. Адреса Grafana з `/config.json` web-образу |
| Метрики (4b)             | OTel Metrics SDK → OTLP → VictoriaMetrics (`-opentelemetry.usePrometheusNaming`); histogram `job_e2e_duration_seconds`, `job_queue_wait_seconds` з лейблами `type`, `class`                        |
| Exemplars (4b)           | VictoriaMetrics не зберігає exemplars. Замість них data links з панелей latency у TraceQL-пошук Tempo (тип, клас, тривалість, вікно панелі) і в логи VictoriaLogs; обмеження описано в ADR         |
| Алерти (4b)              | `vmalert` з recording-правилами SLO і multi-window burn-rate (1 год / 5 хв, 6 год / 30 хв), DLQ > 1%, ріст черги; Alertmanager шле в `webhook-receiver` для демо                                   |
| Дашборди (4b)            | JSON у `deploy/observability/grafana/dashboards`: Overview, SLO, Queues, Per-service, Job                                                                                                          |

## Задачі

### 4a. Трейси і логи

- [x] `libs/observability/telemetry`: старт SDK, ресурс (`service.name`, `service.version`, `deployment.environment`), OTLP-експортери трейсів і логів, auto-instrumentations з фільтрами шуму.
- [x] Хелпери: `traced()` для ручних span'ів, `withJobContext()` для baggage `job.*`; pino mixin з `job_id`.
- [x] `libs/messaging`: inject у `publishJson`, extract і span `CONSUMER` у `PullWorker`.
- [x] Outbox: колонка `trace_context`, запис в `enqueueEvent`, публікація relay в контексті рядка.
- [x] `jobs.trace_id`, `traceId` у відповідях Metadata і Gateway.
- [x] Ручні span'и: `JobRunner`, sharp, ffprobe / ffmpeg, завантаження джерела, доставка вебхука; egress без пропагації назовні.
- [x] Compose: OTel Collector, Tempo, VictoriaLogs, Grafana з provisioning (datasources, звʼязки трейс ↔ логи, дашборд «Job»).
- [x] Web UI: посилання «Трейс і логи» на картці задачі.
- [x] Тести: unit на пропагацію через заголовки NATS і outbox; інтеграційний — один трейс від `POST /v1/jobs` до доставки вебхука (in-memory exporter).
- [x] ADR-010 «Observability: OpenTelemetry, Tempo, VictoriaMetrics, VictoriaLogs».

### 4b. Метрики, дашборди, SLO і алерти

- [x] Метрики на OTel SDK замість `prom-client`; VictoriaMetrics у compose.
- [x] `job_e2e_duration_seconds`, `job_queue_wait_seconds`, throughput, error rate, retries, DLQ, duplicates, глибина кожного стріму, `http_server_duration` для API (за semconv — `http_server_request_duration_seconds`).
- [x] Дашборди як код: Overview, SLO, Queues, Per-service; data links з latency у трейси й логи.
- [x] SLO: `image.resize` 99% < 5 хв, `video.frames` 95% < 5 хв (ADR-008); error budget на дашборді.
- [x] `vmalert`: recording-правила, burn-rate алерти, DLQ > 1%, ріст черги; Alertmanager → `webhook-receiver`.
- [x] k6-сценарій для демо, що наповнює дашборди і викликає burn-rate алерт.
- [x] README: як знайти трейс і логи за `jobId`, де дивитись SLO і алерти.
