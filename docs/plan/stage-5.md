# Етап 5. Kubernetes, KEDA і video.transcode

- Тижні 13–15: 4–24 січня 2027
- Статус: 5.1 готовий, 5.2 і 5.3 — план. Етап розбито на три PR:
  - **5.1 «Кластер і Helm»**, гілка `feature/stage-5.1-k8s-helm`;
  - **5.2 «video.transcode»**, після мерджу 5.1;
  - **5.3 «Автоскейл і graceful shutdown»**, після мерджу 5.2.

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
| Нумерація ADR            | Наступний — ADR-011. Таблиця відповідності номерам PDF у `docs/adr/README.md`                                                                                                                                                                                              |

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

- [ ] Контракт: вхід `sourceKey | sourceUrl` і `renditions: ['480p', '720p']`, вихід зі списком файлів, розмірами й бітрейтом.
- [ ] `TranscodeProcessor`: ffprobe, один прохід ffmpeg з `split` на дві якості, H.264 `veryfast`, AAC, `+faststart`, без апскейлу; ключі `results/<jobId>/<rendition>.mp4`.
- [ ] Прогрес: розбір `-progress pipe:1`; колонка `jobs.progress`; окремий виклик Metadata, дозволений лише в `running` і лише для поточної спроби; не частіше ніж раз на кілька секунд.
- [ ] `progress` у `GET /v1/jobs/:id`, прогрес-бар у Web UI.
- [ ] Окремий таймаут `TRANSCODE_TIMEOUT_MS`; `run-process` приймає AbortSignal.
- [ ] Консюмери `video-transcode-*`; у compose — окремий сервіс `video-transcode` з того самого образу.
- [ ] SLO для `video.transcode` у правилах vmalert і дашборді SLO; поріг обґрунтовується в ADR-011.
- [ ] Тести: unit на аргументи ffmpeg, розбір прогресу, переходи; інтеграційний — транскодинг короткого відео.

### 5.3. Автоскейл і graceful shutdown

- [ ] `PullWorker`: AbortSignal на кожне повідомлення, дедлайн зупинки, скасування і `nak` після нього; `JobRunner` повертає перервану задачу без витрати спроби.
- [ ] `WORKER_SHUTDOWN_GRACE_MS`, узгоджений з `terminationGracePeriodSeconds` у чартах.
- [ ] Deployment'и за класами для воркера картинок і відео; набір консюмерів через env.
- [ ] KEDA ScaledObject для кожного класу: min і max репліки, `lagThreshold`, `cooldownPeriod`, `behavior.scaleDown`; HPA для gateway; PDB; anti-affinity.
- [ ] k6-сценарій `video-load` для кластера.
- [ ] Демо: скейл відео-воркерів з 1 до N і назад; `kubectl rollout restart` під навантаженням; перевірка за метриками (створено = завершено, немає `dead` через рестарт, видимих дублів 0) і SQL-запитом до `job_executions`.
- [ ] Звіт `perf/reports/stage-5.md`: графіки реплік, глибини черг і e2e latency під час скейлу і rollout.
- [ ] ADR-011 «Сигнал автоскейлу, graceful shutdown і SLO для відео»; таблиця відповідності ADR номерам PDF.
- [ ] README: як перевірити автоскейл і rollout.

## Ризики

- **Памʼять.** Кластер з трьох вузлів, інфраструктура, observability, KEDA і 9–10 Deployment'ів. Потрібно щонайменше 12 ГБ у Docker Desktop.
- **Вибір пода при скороченні.** Kubernetes видаляє под не за зайнятістю, тож KEDA може скоротити той, що кодує. Захист — дедлайн, `nak` і повернення задачі без витрати спроби.
- **CPU limits і ffmpeg.** Під limit ffmpeg тротлиться, і транскодинг сповільнюється в рази. Для `video-transcode` limits підбираються вимірюванням.
- **Час збірки.** Образ з ffmpeg великий; registry k3d і кеш шарів, щоб не збирати все щоразу.

## Відкладено на пізніші етапи

- Панелі «DLQ, % проти 1%» і «Дублікати, ‰ проти 0.1‰» та опис методики підрахунку дублікатів в ADR-006 — Етап 6, разом зі звітом chaos-сценаріїв.
- C4-діаграми Context і Container — до фінальної прожарки.
