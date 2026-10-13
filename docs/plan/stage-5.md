# Етап 5. Kubernetes, KEDA і video.transcode

- Тижні 13–15: 4–24 січня 2027
- Статус: готово. Етап розбито на три PR:
  - **5.1 «Кластер і Helm»**, гілка `feature/stage-5.1-k8s-helm`;
  - **5.2 «video.transcode»**, гілка `feature/stage-5.2-video-transcode`;
  - **5.3 «Автоскейл і graceful shutdown»**, гілка `feature/stage-5.3-autoscale-shutdown`.

Назви 5a і 5b не використовуються: у PDF «Етап 5b» — це AWS, домен і перший деплой з CI.

## Результат і критерій

**Результат:** система живе в кластері, воркери скейляться за глибиною черги, а rollout чи вбитий
под не губить жодної задачі, навіть 2-хвилинного транскодингу.

**Готово, коли:**

- під k6-навантаженням відео-воркери скейляться з 1 до N і назад;
- `kubectl rollout restart` під навантаженням не дає втрачених чи подвійних задач, і це видно за
  метриками.

## Що вже є

- `/health/live` не залежить від зовнішніх систем, `/health/ready` перевіряє Postgres, NATS,
  Redis чи S3 залежно від сервісу (`libs/observability/health`).
- `PullWorker` бере повідомлення, лише коли є вільний слот, і кожну третину AckWait шле
  `msg.working()`, тож довга задача не передоставляється посеред роботи.
- `video.transcode` зарезервований у `MEDIA_JOB_TYPES`, клас `cpu`.
- `run-process` запускає ffmpeg без shell і вбиває його `SIGKILL` на таймауті.
- Метрики для перевірки критерію (Етап 4b): `jobs_created_total`, `jobs_finished_total`,
  `jobs_duplicates_total`, `nats_consumer_pending`, `nats_consumer_ack_pending`.
- Helm-чарти з Етапу 0: по одному на сервіс, лише Deployment і Service, без env, Secret,
  resources і startup probe. Немає чартів для `webhook-receiver` і `web`.

## Що треба змінити в наявному коді

- **Graceful shutdown.** `PullWorker.stop()` чекає `WORKER_ACK_WAIT_MS` і виходить, не
  повертаючи незавершені повідомлення. Задача не губиться (JetStream передоставить її після
  AckWait), але до того висить у `running`, а перерване виконання зʼїдає спробу з
  `JOB_MAX_ATTEMPTS`.
- **Воркер картинок обслуговує три класи в одному поді** (`worker-cpu`, `worker-priority`,
  `worker-io`). Для скейлу за класом потрібні окремі Deployment'и з одного образу.
- **Відео-воркер має один слот на под.** Якщо в ньому ж буде транскодинг, `video.frames`
  чекатиме за хвилинними задачами й порушить свій SLO.

## Прийняті рішення

| Питання                  | Рішення                                                                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Локальний кластер        | k3d: 1 server і 2 agent, щоб anti-affinity і PDB мали сенс; локальний registry k3d; metrics-server і Traefik з k3s. Docker Desktop — 12 ГБ RAM                                                                                                                             |
| Інфраструктура           | Без Bitnami (безкоштовні образи більше не публікуються): Postgres — CloudNativePG, NATS — офіційний чарт `nats` з JetStream на PVC, Redis і MinIO — прості маніфести (MinIO на `pgsty/minio`, як у compose), KEDA — офіційний чарт                                         |
| Observability в кластері | Легкі чарти: `victoria-metrics-single`, `victoria-logs-single`, vmalert, Alertmanager, Tempo, OTel Collector, Grafana з тими самими правилами й дашбордами з `deploy/observability`. Без `victoria-metrics-k8s-stack`                                                      |
| Чарти сервісів           | Library-чарт `pdp-lib` зі спільними шаблонами (Deployment, Service, probes, HPA, ScaledObject, PDB) і umbrella-чарт `pdp` з `values-dev.yaml` та `values-prod.yaml`. Сервісні чарти стають тонкими                                                                         |
| Міграції                 | Job з хуком `pre-install,pre-upgrade`. `DATABASE_URL` береться із Secret, який створює CloudNativePG (`<cluster>-app`, ключ `uri`), тож Secret існує до хука                                                                                                               |
| Probes                   | `startupProbe` на `/health/live` для повільного старту, `readinessProbe` на `/health/ready`, `livenessProbe` на `/health/live`. Gateway має `preStop` sleep, щоб вийти з endpoints до SIGTERM                                                                              |
| Відео по подах           | Один образ, два Deployment'и: `video-frames` і `video-transcode`, кожен зі своїми консюмерами, limits і ScaledObject. Набір типів задає env                                                                                                                                |
| Воркер картинок          | Один образ, Deployment на клас: `worker-cpu`, `worker-priority`, `worker-io` (вебхуки). Набір консюмерів задає env                                                                                                                                                         |
| Graceful shutdown        | На SIGTERM перестати брати повідомлення; чекати поточні до дедлайну (`terminationGracePeriodSeconds` мінус запас); потім скасувати обробку (AbortSignal → `SIGKILL` ffmpeg) і зробити `nak`, щоб інший под одразу взяв задачу. Переривання через shutdown не зʼїдає спробу |
| Сигнал автоскейлу        | Нативний `nats-jetstream` scaler KEDA. Його lag — `num_pending + num_ack_pending`, тобто задачі в роботі теж рахуються, і зайнятий под не вважається зайвим. `lagThreshold` дорівнює кількості слотів на под                                                               |
| Gateway                  | HPA за CPU, мінімум 2 репліки. PDB і `preferred` anti-affinity для gateway і воркерів                                                                                                                                                                                      |
| Нумерація ADR            | ADR-011 — транскодинг (5.2), ADR-012 — автоскейл і shutdown (5.3). Таблиця відповідності номерам PDF у `docs/adr/README.md`                                                                                                                                                |

## Задачі

### 5.1. Кластер і Helm

- [x] `scripts/k8s.sh up|down|status` і `pnpm k8s:up` / `pnpm k8s:down`: кластер k3d, registry, build і push образів, установка інфраструктури й релізу `pdp`.
- [x] Інфраструктура: CloudNativePG (оператор і `Cluster`), NATS з JetStream і monitoring-портом, Redis, MinIO з ініціалізацією бакета, KEDA.
- [x] Observability в кластері з наявними конфігами Collector, правилами vmalert і дашбордами.
- [x] `pdp-lib` і umbrella `pdp`; чарти для всіх сервісів, включно з `webhook-receiver` і `web`; env, Secret, resources, `securityContext` (non-root, `readOnlyRootFilesystem`, `emptyDir` для `/tmp`).
- [x] Відео: `emptyDir` з `sizeLimit` для `VIDEO_WORK_DIR` (ризик з ADR-008), більші limits.
- [x] Міграції як хук, probes, `preStop` у gateway.
- [x] Ingress через Traefik: `api.pdp.localhost`, `grafana.pdp.localhost`, `app.pdp.localhost`.
- [x] `values-dev.yaml` (k3d) і `values-prod.yaml` (без секретів у values, `existingSecret`).
- [x] CI: `helm lint`, `helm template` і валідація маніфестів kubeconform разом зі схемами CRD.
- [x] README: як підняти кластер і пройти наскрізний сценарій у ньому.

Як зроблено:

- **Два релізи в namespace `pdp`.** `platform` (`deploy/helm/platform`) — інфраструктура й observability, `pdp` — застосунок. Оператори CloudNativePG і KEDA ставляться окремо й раніше, бо їхні CRD потрібні платформі. Імена сервісів ті самі, що в compose (`nats`, `redis`, `minio`, `otel-collector`, `tempo`, `victoriametrics`…), тож конфіги з `deploy/observability` підключаються без змін через symlink `platform/files/observability`.
- **Чарти Grafana** переїхали в репозиторій `grafana-community` (Tempo і Grafana беруться звідти). Alertmanager — вбудований у чарт `victoria-metrics-alert`, він сам прописує notifier у vmalert.
- **Теги образів — ID образу** (перші 12 символів), тож `pnpm k8s:up` перезапускає лише сервіси зі зміненим образом, а `SERVICE_VERSION` у телеметрії збігається з образом.
- **Один проксі.** На `app.pdp.localhost` Traefik веде `/v1` і `/docs` прямо в gateway, а решту — у `web`, тож між клієнтом і gateway рівно один проксі й `TRUST_PROXY_HOPS=1`. Presigned URL підписуються на `s3.pdp.localhost`.
- **Секрети за посиланням.** `DATABASE_URL` — із Secret `postgres-app` від CloudNativePG, ключі S3 — із `s3-credentials`; у values застосунку лише імена Secret і ключів.
- **Grafana** отримує 768 МБ limit: зі встановленням плагіна VictoriaLogs на старті вона не вкладалась у 384 МБ (OOMKilled).
- **Перевірка чартів** — `scripts/helm-check.sh` (`pnpm helm:lint`, CI job `helm`): `helm lint` усіх чартів і kubeconform для `platform` та `pdp` з dev- і prod-values, CRD — за схемами з datreeio/CRDs-catalog. Вона одразу знайшла дубльовану мітку в Job міграцій.
- **Наскрізна перевірка** — той самий `scripts/e2e-smoke.sh` з `KUBE_NAMESPACE=pdp`. Кластер з нуля піднімається приблизно за 4 хв і в спокої займає близько 4 ГБ.

### 5.2. video.transcode

- [x] Контракт: вхід `sourceKey | sourceUrl` і `renditions: ['480p', '720p']`, вихід зі списком файлів, розмірами й бітрейтом.
- [x] `TranscodeProcessor`: ffprobe, один прохід ffmpeg з `split` на дві якості, H.264 `veryfast`, AAC, `+faststart`, без апскейлу; ключі `results/<jobId>/<rendition>.mp4`.
- [x] Прогрес: розбір `-progress pipe:1`; колонка `jobs.progress`; окремий виклик Metadata, дозволений лише в `running` і лише для поточної спроби; не частіше ніж раз на кілька секунд.
- [x] `progress` у `GET /v1/jobs/:id`, прогрес-бар у Web UI.
- [x] Окремий таймаут `TRANSCODE_TIMEOUT_MS`; `run-process` приймає AbortSignal.
- [x] Консюмери `video-transcode-*`; у compose — окремий сервіс `video-transcode` з того самого образу.
- [x] SLO для `video.transcode` у правилах vmalert і дашборді SLO; поріг обґрунтовується в ADR-011.
- [x] Тести: unit на аргументи ffmpeg, розбір прогресу, переходи; інтеграційний — транскодинг короткого відео.

Як зроблено (деталі й альтернативи — [ADR-011](../adr/0011-video-transcode.md)):

- **Якість за коротшою стороною**, з урахуванням повороту з метаданих: вертикальне 1080x1920 отримує 480x854 і 720x1280. Більші за джерело якості йдуть у `skipped`; якщо не підходить жодна — `permanent`. Тривалість — до 5 хв (`TRANSCODE_MAX_DURATION_SECONDS`).
- **Прогрес — умовний `UPDATE ... WHERE status = 'running' AND attempts = $attempt`**, а не перехід: без `job_transitions`, outbox і зміни `updated_at`. Воркер шле цілі відсотки не частіше ніж раз на `JOB_PROGRESS_INTERVAL_MS` (3 с), не чекає відповіді й зупиняється на 4xx; до успіху значення не більше 99. Gateway показує прогрес лише для `running`.
- **Типи за env.** `VIDEO_JOB_TYPES` (за замовчуванням обидва) вибирає процесори й консюмери. Консюмери кадрів зберегли імена `video-priority`/`video-cpu`. У Helm той самий чарт `video-worker` підключений вдруге з `alias: video-transcode`, а `k8s.sh` передає йому тег образу video-worker.
- **SLO: 95% за 10 хв.** Поріг — мітка `le` на `job:slo_objective:ratio`, «успішні вчасно» вибираються через `and on (type, le)`, дашборд SLO бере `le` прихованою змінною. Межа 600 вже була в бакетах; у бакети спроб її додано.
- **Виміряно в compose:** 60 с відео 1080p з аудіо кодується за 6 с без ліміту CPU і за 18 с з лімітом 2 CPU, пік памʼяті близько 560 МіБ. Звідси limits `2 CPU / 1536Mi` для `video-transcode`.
- **Web UI:** перемикач «Кадри / Транскодинг» у панелі завантаження, прогрес-бар на картці під час кодування, якості — посиланнями на MP4.

### 5.3. Автоскейл і graceful shutdown

- [x] `PullWorker`: AbortSignal на кожне повідомлення, дедлайн зупинки, скасування і `nak` після нього; `JobRunner` повертає перервану задачу без витрати спроби.
- [x] `WORKER_SHUTDOWN_GRACE_MS`, узгоджений з `terminationGracePeriodSeconds` у чартах.
- [x] Deployment'и за класами для воркера картинок і відео; набір консюмерів через env.
- [x] KEDA ScaledObject для кожного класу: min і max репліки, `lagThreshold`, `cooldownPeriod`, `behavior.scaleDown`; HPA для gateway; PDB; anti-affinity.
- [x] k6-сценарій `video-load` для кластера.
- [x] Демо: скейл відео-воркерів з 1 до N і назад; `kubectl rollout restart` під навантаженням; перевірка за метриками (створено = завершено, немає `dead` через рестарт, видимих дублів 0) і SQL-запитом до `job_executions`.
- [x] Звіт `perf/reports/stage-5.md`: графіки реплік, глибини черг і e2e latency під час скейлу і rollout.
- [x] ADR-012 «Сигнал автоскейлу і graceful shutdown»; таблиця відповідності ADR номерам PDF.
- [x] README: як перевірити автоскейл і rollout.

Як зроблено (деталі й альтернативи — [ADR-012](../adr/0012-autoscaling-and-graceful-shutdown.md), цифри — [звіт](../../perf/reports/stage-5.md)):

- **Дедлайн справді діє.** Очікування слота в `Semaphore.acquire(signal)` переривається на зупинці, тож зайнятий под одразу перестає брати повідомлення, а не після кінця поточної задачі. Повідомлення, що прийшло у вже відкритий fetch після зупинки, отримує `nak`. `stop(grace)` чекає задачі до дедлайну, потім скасовує їх `WorkerShutdownError` і дає ще 5 с.
- **`interrupted` — новий варіант переходу `running → scheduled`.** `JobRunner` шле його, якщо процесор упав після скасування, і робить `nak(0)`. Metadata пише виконанню `outcome = 'interrupted'` (міграція `0005`), не рахує такі виконання в спроби покоління, не змінює `lastError` і не перетворює переривання на `dead / exhausted`. Лічильник — `jobs_interrupted_total{type}`; у гістограмі спроб — `outcome="interrupted"`.
- **Сигнал до ffmpeg — лише в транскодингу.** Кадри, превʼю й завантаження тривають секунди й вкладаються в grace.
- **Один параметр на под.** `shutdownGraceSeconds` у values задає і `WORKER_SHUTDOWN_GRACE_MS`, і `terminationGracePeriodSeconds` (+15 с): 20 с для воркерів картинок, 30 с для кадрів, 60 с для транскодингу.
- **Deployment'и.** Umbrella підключає чарт `worker` тричі (`worker-priority`, `worker-cpu`, `worker-io`, `WORKER_CLASSES`) і `video-worker` двічі (`video-frames`, `video-transcode`). Спільні env — YAML-якорі у values. `k8s.sh` передає тег образу кожному alias.
- **Скейлинг у `pdp-lib/_scaling.tpl`:** ScaledObject з тригером `nats-jetstream` на кожен консюмер або HPA за CPU, PDB для всіх, `replicas` не рендериться, коли є автоскейлер. `pollingInterval` і `cooldownPeriod` KEDA діють лише для `minReplicas: 0`, тож шаблон додає їх лише тоді; скорочення задає `behavior.scaleDown`.
- **Gateway** — 2–4 репліки за CPU, `RATE_LIMIT_REPLICAS=2` для локального запасного ліміту.
- **Демо** — `scripts/autoscale-demo.sh` з k6 `perf/k6/video-load.js`; графіки — `scripts/autoscale-report.mjs`. Rollout зі штатним grace перевіряє, що задачі доходять до кінця на старих подах, а rollout з `WORKER_SHUTDOWN_GRACE_MS=2000` — що перервані транскодинги повертаються без витрати спроби.
- **`requests` за роллю.** Перший прогін демо дав `503` і `abandoned` спроби: при конкуренції CPU ділиться за `requests`, і Metadata з 50m голодувала поруч з подами ffmpeg. `requests.cpu` Metadata, gateway і Postgres — 250m, Redis — 100m.

## Ризики

- **Памʼять.** Кластер з трьох вузлів, інфраструктура, observability, KEDA і 9–10 Deployment'ів. Потрібно щонайменше 12 ГБ у Docker Desktop.
- **Вибір пода при скороченні.** Kubernetes видаляє под не за зайнятістю, тож KEDA може скоротити той, що кодує. Захист — дедлайн, `nak` і повернення задачі без витрати спроби.
- **CPU limits і ffmpeg.** Під limit ffmpeg тротлиться, і транскодинг сповільнюється в рази. Для `video-transcode` limits підбираються вимірюванням.
- **Час збірки.** Образ з ffmpeg великий; registry k3d і кеш шарів, щоб не збирати все щоразу.

## Відкладено на пізніші етапи

- Панелі «DLQ, % проти 1%» і «Дублікати, ‰ проти 0.1‰» та опис методики підрахунку дублікатів в ADR-006 — Етап 6, разом зі звітом chaos-сценаріїв.
- C4-діаграми Context і Container — до фінальної прожарки.
