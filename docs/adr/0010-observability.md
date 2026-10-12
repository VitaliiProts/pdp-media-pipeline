# ADR-010. Observability: OpenTelemetry, Tempo, VictoriaLogs, VictoriaMetrics

- Статус: Прийнято
- Дата: 2026-10-12

## Контекст

Задача проходить п'ять процесів: Gateway, Metadata, Scheduler, воркер і ще раз воркер для
доставки вебхука. Між ними HTTP, NATS JetStream і transactional outbox у Postgres. До Етапу 4
кожен сервіс писав власні pino-логи в stdout, а з метрик були лише лічильники prom-client.
Відповісти на питання «що сталося з задачею X» можна було тільки вручну: grep у п'яти логах
і зіставлення за часом.

Ціль Етапу 4 з плану PDP: за будь-яким `jobId` за хвилину знайти повний трейс і всі логи, а
SLO бачити на дашборді. Стек задано планом: OpenTelemetry, VictoriaMetrics, Grafana,
VictoriaLogs і Pino. Для трейсів — Jaeger або Tempo.

Етап розбито на два PR. 4a: трейси і логи. 4b: метрики, дашборди, SLO і алерти (розділи
«Метрики» і далі).

## Рішення

### Один SDK, один колектор

Кожен Node-сервіс стартує `NodeSDK` із `@pdp/observability/telemetry`. Це перший імпорт у
`main.ts`, бо інструментації патчать `http`, `pg` і `pino` у момент їхнього першого `require`.
Сервіси шлють OTLP/HTTP на OpenTelemetry Collector. Лише колектор знає про бекенди: трейси
йдуть у Tempo, логи у VictoriaLogs, метрики у VictoriaMetrics.

Інтеграційні тести SDK не стартують: API OpenTelemetry без SDK — no-op, тому код зі span'ами
працює і без нього. Тест одного трейсу вмикає in-memory експортер явно
(`@pdp/observability/testing`).

### Автоматичні і ручні span'и

Автоматично: вхідний і вихідний HTTP (`http`, `undici` для `fetch`), Postgres, Redis, S3 і
Nest-обробники. Щоб фонові цикли не створювали кореневий трейс кожні 50 мс, вихідні запити, pg і
redis пишуться лише всередині вже наявного span'а: polling outbox, readiness-перевірки і
heartbeat'и трейсів не дають. Запити до `/health` ігноруються.

Ручні span'и стоять там, де автоматика нічого не бачить або бачить не те:

- `job create`: вставка задачі в Metadata;
- `job process <type>`: робота процесора у воркері;
- `source fetch` / `source download`: джерело зі сховища чи за URL, на весь час передачі, а не
  лише до заголовків відповіді;
- `sharp metadata`, `sharp resize` (окремий span на кожен пресет), `ffprobe`,
  `ffmpeg preview`, `ffmpeg frames`;
- `egress <method>`: вихідний запит на адресу користувача (див. нижче).

### Контекст через NATS і outbox

NATS-клієнт сам контекст не переносить. `NatsService.publishJson` створює span `send <subject>`
(PRODUCER) і кладе `traceparent`, `tracestate` і `baggage` у заголовки повідомлення.
`PullWorker` дістає їх і запускає обробник у span'і `process <subject>` (CONSUMER), дочірньому
до продюсера. Атрибути беруться з messaging semconv. Результат обробки (`ack`, `nak`, `term`)
теж стає атрибутом span'а.

Outbox розриває виконання: подію записує HTTP-запит, а публікує фоновий relay. Тому
`enqueueEvent` зберігає поточний контекст у колонку `outbox.trace_context`, а relay
публікує кожен рядок усередині збереженого контексту. Подія, записана запитом
`POST /v1/jobs`, продовжує саме його трейс. Ланцюжок
`POST /v1/jobs → outbox → scheduler → worker → transition → outbox → scheduler → webhook`
стає одним трейсом.

### `job.id` через baggage

Атрибути `job.id`, `job.type` і `job.class` потрібні на кожному span'і та в кожному рядку логу,
інакше пошук за `jobId` не працює. Передавати їх параметрами через усі шари довго і крихко,
тому їх несе W3C baggage:

- `insertJob` у Metadata кладе `job.id` і `job.type` у baggage до запису події. Через outbox
  baggage дістається Scheduler, той додає `job.class`, а далі baggage йде у воркер і назад у
  Metadata по HTTP.
- `BaggageSpanProcessor` у кожному сервісі копіює `job.*` з baggage в атрибути кожного нового
  span'а.
- `mixin` у pino додає `job_id`, `job_type`, `job_class` у кожен рядок логу.

Доставка вебхука — окрема задача зі своїм `job.id`, але в тому самому трейсі: `withJobContext`
замінює `job.*` батьківської задачі, а не доповнює їх.

### Логи

Pino лишається основним логером, логи, як і раніше, пишуться в stdout. `instrumentation-pino`
додає `trace_id` і `span_id` у кожен рядок, а копію запису шле OTLP у колектор і далі у
VictoriaLogs. Окремий агент збору логів (Vector, Promtail) локально не потрібен. Потоки
VictoriaLogs ділимо за `service.name`, решта полів — звичайні поля, за якими працює пошук.

### Межі довіри

- **Gateway — edge.** Він ігнорує `traceparent` і `baggage` від клієнтів: інакше будь-хто
  міг би приєднатися до наших трейсів або підкласти свій `job.id` у наші логи. Вниз по
  ланцюжку контекст передається як звичайно.
- **Egress не передає контекст назовні.** Запит на адресу користувача (джерело за URL,
  вебхук) отримує один CLIENT-span, а сам запит іде під `suppressTracing`. Тому
  `traceparent` і `baggage` з ідентифікаторами задач не потрапляють на чужий сервер. У span
  пишеться лише хост: шляхи і query вебхуків часто містять токени.

### Від задачі до трейсу і назад

- `jobs.trace_id` зберігає трейс запиту, який створив або востаннє перезапустив задачу.
  Gateway віддає його як `traceId`.
- Web читає `/config.json`, який nginx рендерить з `GRAFANA_URL`, і показує на картці
  задачі посилання «Трейс і логи». Воно веде на дашборд **Job**: трейс, логи задачі з усіх
  сервісів і таблиця всіх трейсів із цим `job.id` (оригінал і кожен redrive).
- У Grafana рядок логу посилається на свій трейс (derived field `trace_id` → Tempo), а span —
  на логи свого трейсу (trace-to-logs у VictoriaLogs).

### Метрики

`prom-client` і `/metrics` прибрано. Метрики пише той самий `NodeSDK`:
`PeriodicExportingMetricReader` раз на 15 с шле OTLP у колектор, а той у VictoriaMetrics з
`-opentelemetry.usePrometheusNaming`. Тому `job.e2e.duration` з одиницею `s` зберігається як
`job_e2e_duration_seconds_*`, а лічильник `jobs.dlq` як `jobs_dlq_total`. Колектор лишає в
ресурсі тільки `service.name`, `deployment.environment.name` і `host.name`: VictoriaMetrics
робить мітку з кожного атрибута ресурсу, і з pid чи версією рантайму кожен рестарт починав би
нові серії.

Доменні метрики живуть в одному місці, `jobMetrics` у `@pdp/observability`:

| Метрика у VictoriaMetrics                      | Де пишеться                                    |
| ---------------------------------------------- | ---------------------------------------------- |
| `job_e2e_duration_seconds{type,class,outcome}` | Metadata, після коміту `succeeded` чи `dead`   |
| `job_queue_wait_seconds{type,class}`           | Metadata, на першому `running` покоління       |
| `jobs_created_total`, `jobs_finished_total`    | Metadata                                       |
| `jobs_retries_total`, `jobs_dlq_total`         | Metadata                                       |
| `jobs_duplicates_total{source}`                | Metadata (inbox, outbox), Scheduler (dispatch) |
| `job_attempt_duration_seconds{type,outcome}`   | воркери, `JobRunner`                           |
| `messaging_process_duration_seconds`           | усі консюмери, `PullWorker`                    |
| `nats_stream_messages`, `nats_consumer_*`      | Scheduler, observable gauges з JetStream API   |
| `http_server_request_duration_seconds`         | `instrumentation-http`, мітка `http_route`     |

Рішення, які не видно з назв:

- **Час з годинника Metadata.** Обидві точки e2e і queue wait — рядки Metadata, тож розбіжність
  годинників між подами на метрику не впливає.
- **Redrive не в SLI.** Повторне покоління рахується в `jobs_finished_total`, але не в
  `job_e2e_duration_seconds`: його вік включає час, коли задача лежала мертвою до рішення
  оператора.
- **Queue wait лише першої спроби.** Очікування повторних спроб — це backoff, а не черга.
- **Межа 300 с у бакетах.** SLI рахує бакет `le="300"`, тому 5 хв — обовʼязкова межа гістограми.
- **Глибину черг звітує Scheduler.** Він бачить усі стріми. Gauges читають JetStream на кожен
  експорт; кілька реплік дають однакові значення, дашборди беруть `max`.
- **`http_route` з Nest.** Інтерсептор з 4a кладе шаблон маршруту в RPC-метадані, і
  `instrumentation-http` бере його і для span'а, і для мітки метрики. Без нього мітки не було б
  взагалі або була б з конкретним id, тобто необмежена кардинальність.
- **Без самошуму.** Експорт у колектор не потрапляє в метрики HTTP-клієнта.

### SLO і алерти

SLI для `image.resize` (99%) і `video.frames` (95%) з ADR-001 і ADR-008: частка задач, що
успішно завершились не пізніше ніж за 5 хв від створення, серед завершених. `permanent`-відмови
(биті файли, 404 за URL) не рахуються: їх не виправить ні ретрай, ні масштабування, і це не
латентність конвеєра. `exhausted` і повільні успіхи — погані події.

`vmalert` рахує recording-правила `job:slo_errors:ratio_rate{5m,30m,1h,6h}` і
`job:slo_burn_rate:*`, а ціль лежить окремою серією `job:slo_objective:ratio`. Алерти за
Google SRE workbook (multi-window, multi-burn-rate): `JobSloBurnRateFast` (1 год і 5 хв понад
14.4, `page`) і `JobSloBurnRateSlow` (6 год і 30 хв понад 6, `ticket`). Довге вікно доводить,
що горить суттєво, коротке — що горить досі, тож алерт знімається скоро після виправлення.
Окремо `JobDeadLetterShareHigh` (понад 1% завершених задач за 15 хв, від 20 задач) і
`JobQueueGrowing` (backlog консюмера понад 100 і росте 5 хв).

Правила рахують `increase`, а не `rate`: VictoriaMetrics рахує серію, що зʼявилась усередині
вікна, від нуля лише в `increase`, а серія `outcome="exhausted"` зʼявляється разом з першою
такою задачею. Правила мають юніт-тести на `vmalert-tool` (`pnpm alerts:test`, і в CI).

Alertmanager групує за `alertname` і `type`; поки горить `JobSloBurnRateFast`, `JobSloBurnRateSlow` того ж типу не надсилається. У compose
обидва йдуть у `webhook-receiver` (`POST /alerts`), реальний маршрут — справа Stage 5.

### Дашборди і заміна exemplars

Дашборди лежать JSON'ами в `deploy/observability/grafana/dashboards` і провіжняться при старті:
Overview, SLO, Queues, Per-service і Job з 4a.

Exemplars у Prometheus зберігають `trace_id` окремих вимірів, і з точки на графіку латентності
можна відкрити конкретний трейс. VictoriaMetrics exemplars не зберігає. Замість них панелі
латентності мають data links: TraceQL-пошук у Tempo за міткою серії і вікном панелі
(`{ span.job.type = "image.resize" && traceDuration > 5m }`, повільні трейси маршруту, трейси
з помилкою) і логи у VictoriaLogs за `job_type`. Це не той самий вимір, що на точці графіка,
а вибірка схожих: для питання «чому p95 виріс» цього зазвичай досить.

## Наслідки

- Пошук за `jobId` — одне посилання з UI або запит `{ span.job.id = "<id>" }` у Tempo чи
  `job_id:="<id>"` у VictoriaLogs.
- Тест `test/telemetry.int-spec.ts` проганяє справжні сервіси в одному процесі і перевіряє, що
  задача від `POST /v1/jobs` до доставки вебхука має один трейс з одним коренем.
- Нова колонка `outbox.trace_context` (кілька сотень байт на подію) і `jobs.trace_id`.
- Трейс задачі з вебхуком — понад сотню span'ів, більшість із них pg-запити. Локально це
  нормально. Для навантаження в Stage 5 знадобиться sampling, найпростіше — tail sampling у
  колекторі, щоб зберігати всі трейси з помилками.
- Telemetry best effort: сервіси не чекають на колектор, а якщо він лежить, span'и і логи в
  OTLP губляться. stdout-логи лишаються.
- Tempo локально зберігає блоки в контейнері, тож після його перестворення трейси зникають.
  Логи у VictoriaLogs і метрики у VictoriaMetrics лежать у volume.
- Метрики теж best effort: поки колектор лежить, 15-секундні експорти губляться, але лічильники
  кумулятивні, тож після відновлення `increase` наздоганяє.
- При малому трафіку SLI шумний: одна погана задача з десяти — це 10%. Burn-rate алерти
  гасять це довгим вікном, а `JobDeadLetterShareHigh` має поріг у 20 задач.
- Data links ведуть на схожі трейси, а не на той, що дав конкретну точку графіка.

## Альтернативи

- **Jaeger замість Tempo.** Jaeger теж приймає OTLP і має гарний UI. Tempo обрано, бо він
  вбудовується в ту саму Grafana, що й логи та метрики, а TraceQL дає пошук за атрибутом
  `job.id` без окремого індексу.
- **Логи через stdout і агент (Vector/Promtail).** Це канонічний шлях для Kubernetes:
  застосунок не знає про бекенд. Локально це ще один контейнер з доступом до Docker socket.
  OTLP-логи йдуть тим самим шляхом, що й трейси, і `trace_id` в них є з коробки. У k8s можна
  повернутися до агента, бо stdout-логи нікуди не зникли.
- **`job.id` атрибутом лише на окремих span'ах.** Простіше, але пошук знайде тільки ці span'и,
  а не логи інших сервісів. Baggage коштує кілька десятків байт у кожному запиті між нашими
  сервісами.
- **Контекст у тілі події, а не в заголовках NATS.** Тоді контракт подій залежав би від
  трасування. Заголовки — стандартне місце для W3C-контексту, і воно не чіпає схему подій.
- **Exemplars для переходу з метрик на трейси.** VictoriaMetrics exemplars не зберігає.
  Prometheus лише заради них — другий TSDB з тими самими даними. Замінено data links (див.
  «Дашборди і заміна exemplars»).
- **`prom-client` і scrape колектором.** Працювало б, але тоді метрики йдуть іншим шляхом,
  ніж трейси і логи, і без спільного ресурсу (`service.name`, середовище). OTel SDK дає ще й
  `http.server.request.duration`, runtime-метрики Node і метрики pg без власного коду.
- **SLO-генератори (Sloth, Pyrra).** Генерують ті самі recording-правила з короткого опису.
  Для двох SLO рукописні правила з тестами простіші, ніж ще один інструмент у збірці.
- **Помилки і латентність як два окремі SLO.** Користувачу важливо одне: результат за 5 хв.
  Один SLI, де погана подія — і збій, і запізнення, дає один бюджет і один набір алертів.
