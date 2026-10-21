# Підетап 6.1 — chaos у k3d: план реалізації

> **Для агентів:** виконувати задачу за задачею (superpowers:executing-plans або
> subagent-driven-development), кроки — чекбокси `- [ ]`.

**Мета:** кожен сценарій збою з [`stage-6.md`](stage-6.md) проганяється однією командою під
навантаженням у k3d, і аудитор після прогону показує загублені задачі, дублікати ‰ і DLQ %.

**Архітектура:** Chaos Mesh ставиться в k3d окремою командою `scripts/k8s.sh chaos-mesh`.
`scripts/chaos.sh <сценарій|all>` для кожного сценарію: створює свіжого користувача з вебхуком,
вмикає `video-dub` на `openai-mock`, запускає k6 `perf/k6/chaos.js`, через хвилину застосовує
маніфест збою з `deploy/chaos/`, після k6 знімає збій, чекає порожніх черг і запускає
`scripts/chaos-audit.mjs`. Аудитор читає Postgres (через `kubectl exec` у `postgres-1`), лічильники
`openai-mock`, підсумок k6 і VictoriaMetrics і пише JSON у `perf/reports/raw/stage-6/`.

**Стек:** Chaos Mesh 2.8.5 (Helm), k6 1.3 у Docker, Node 24 без залежностей для `openai-mock` і
аудитора, bash як у `scripts/autoscale-demo.sh`.

## Глобальні обмеження

- Коміти — `feat(chaos): …`, `fix(<сервіс>): …`, `docs(stage-6.1): …`, трейлер
  `Co-authored-by: Cursor <cursoragent@cursor.com>`. Не пушити й не мерджити: користувач робить
  це сам.
- Справжній OpenAI у chaos-прогонах не викликається: `OPENAI_BASE_URL` веде на `openai-mock`,
  ключ — `sk-chaos`.
- Медіа з Tears of Steel / Sprite Fright не використовуються; фікстура генерується ffmpeg.
- Скрипти — у стилі `scripts/autoscale-demo.sh`: `set -euo pipefail`, `need`, `log`, `sql`.
  Перевірка — `shellcheck`. Сирі дані — у `perf/reports/raw/stage-6/` (у `.gitignore`); у репо
  потрапляють лише зведення для звіту.
- Кожне виправлення, знайдене chaos-прогоном, — окремий коміт із тестом (unit або
  інтеграційним), що відтворює збій без кластера.
- Перевірки перед комітом: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `shellcheck`
  для змінених скриптів.

## Уточнення методики

Розвідка коду змінила три рядки таблиці методики з `stage-6.md`:

- **Вебхуки рахуються в Postgres, а не в `webhook-receiver`.** Приймач тримає в пам'яті лише 500
  останніх доставок, а доставка за дизайном — at-least-once (одержувач дедупить за
  `webhook-id`), тож повтор HTTP-запиту дублікатом не є. Видимий дублікат — друга задача
  `webhook.deliver` на ту саму подію: `count(*)` за `input->'payload'->'data'->>'jobId'` і
  `input->'payload'->>'type'` більше 1. Нуль доставок на завершену задачу — загублений вебхук.
- **S3 не перевіряється.** Ключі результатів детерміновані (`results/<jobId>/…`), повтор
  перезаписує той самий об'єкт — видимого ефекту немає за побудовою.
- **Сценарій 8 — збої вносить сам `openai-mock`, без `HTTPChaos`.** Щоб порахувати «за готовий
  крок другий раз не платимо», mock має знати, які відповіді «оплачені». Якщо відповідь підміняє
  проксі Chaos Mesh, mock бачить 200, а клієнт — 500, і лічильник бреше. Тому mock сам відповідає
  `500`/`429`/із затримкою за налаштуванням `PUT /faults`, рахує лише свої 200 і окремо — 200, які
  клієнт уже не дочекався (сокет закрито до відповіді). Те саме працює в AWS.
- **«На один ключ — одна задача»** гарантує первинний ключ `idempotency_keys (user_id, key)`, тож
  перевірка — з двох боків: k6 рахує повтори з тим самим ключем, що повернули інший `jobId`
  (`chaos_key_mismatch`), а аудитор — медіа-задачі користувача прогону без рядка в
  `idempotency_keys`.

## Мапа файлів

| Файл                                          | Що                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `scripts/k8s.sh`                              | команда `chaos-mesh`: репозиторій, чарт 2.8.5, сокет containerd k3s    |
| `perf/openai-mock/server.mjs` (+ `.test.mjs`) | фейковий OpenAI: транскрипція, переклад, рефіт, лічильники, збої       |
| `deploy/chaos/openai-mock.yaml`               | Deployment `node:24-alpine` + Service; код — ConfigMap із `server.mjs` |
| `perf/k6/chaos.js`                            | ~5 задач/с, `Idempotency-Key` з префіксом, повтори з тим самим ключем  |
| `scripts/chaos-audit.mjs`                     | перевірки методики, JSON і рядок таблиці                               |
| `scripts/chaos.sh`                            | раннер: користувач, вебхук, dub → mock, k6, збій, дренаж, аудит        |
| `deploy/chaos/NN-*.yaml`                      | 10 сценаріїв                                                           |
| `deploy/helm/platform/dashboards/…`           | панелі «DLQ, % проти 1%» і «Перехоплені дублікати за джерелом»         |
| `docs/plan/stage-6.md`, `.gitignore`          | уточнена методика; `perf/k6/fixtures/chaos.mp4`                        |

## Задача 1. Spike: Chaos Mesh у k3d

Від неї залежить решта: чи працюють `NetworkChaos` (tc/ipset у вузлі-контейнері k3d на ядрі
Docker Desktop) і `StressChaos`.

- [x] `scripts/k8s.sh up` (кластер з образами, ~10 хв).
- [ ] Поставити Chaos Mesh руками і дозволити йому namespace `pdp`:

  ```bash
  helm install chaos-mesh chaos-mesh/chaos-mesh -n chaos-mesh --create-namespace --version 2.8.5 \
    --set chaosDaemon.runtime=containerd \
    --set chaosDaemon.socketPath=/run/k3s/containerd/containerd.sock \
    --set controllerManager.replicaCount=1 --set dashboard.create=false \
    --set controllerManager.enableFilterNamespace=true
  kubectl annotate ns pdp chaos-mesh.org/inject=enabled
  ```

- [ ] Перевірити по черзі, кожен на 30 с, на `worker-cpu`:
  - `PodChaos pod-kill` — под перестворюється;
  - `NetworkChaos delay 200ms` — `kubectl exec` у под: `wget` до `metadata` повільніший;
  - `NetworkChaos partition` до `postgres` — `kubectl -n pdp get pods` показує, що Metadata
    втрачає readiness;
  - `StressChaos memory` — контейнер отримує `OOMKilled`.
- [ ] Записати результат у цей план (розділ «Результат spike»). Якщо `NetworkChaos` не працює —
      сценарії 4, 5, 10 через NetworkPolicy (`deploy/chaos/netpol/*.yaml`, застосовує k3s), а
      затримка і втрата (сценарій 6) — лише в AWS-сесії.

## Задача 2. Chaos Mesh у `scripts/k8s.sh`

- [ ] `CHAOS_MESH_VERSION=2.8.5`, у `repos()` — `helm repo add chaos-mesh https://charts.chaos-mesh.org`.
- [ ] Функція `chaos_mesh()` з параметрами зі spike, `--wait --timeout 5m`; команда
      `scripts/k8s.sh chaos-mesh` і рядок у шапці скрипта. У `up` не входить: звичайному k3d
      вона не потрібна.
- [ ] `shellcheck scripts/k8s.sh`; на кластері — `scripts/k8s.sh chaos-mesh` двічі поспіль
      (ідемпотентність).
- [ ] Коміт `feat(chaos): Chaos Mesh in k3d`.

## Задача 3. `openai-mock`

`perf/openai-mock/server.mjs` — Node без залежностей, порт `PORT` (8080):

- `POST /v1/audio/transcriptions` — два сегменти, як `fakeOpenAi()` у `test/dub-kill.int-spec.ts`;
- `POST /v1/chat/completions` — переклад (є `segments`) або рефіт (є `fullest`), відповідь за
  запитом, `usage`;
- `GET /calls` → `{ transcribe: { paid, abandoned, failed }, translate: {…}, refit: {…} }`,
  `DELETE /calls` — обнулити;
- `PUT /faults` `{ status?: 500 | 429, rate: 0..1, delayMs?: number }`, `DELETE /faults`.
  Відповідь зі збоєм — `failed`; 200, на яку клієнт закрив сокет до запису (`res.destroyed` або
  `req` `close` раніше), — `abandoned`; решта 200 — `paid`;
- `GET /health` — 200.

Кроки:

- [ ] Тест `perf/openai-mock/server.test.mjs` на `node:test`: транскрипція й переклад дають
      `paid: 1`; `PUT /faults {status: 500, rate: 1}` → 500 і `failed: 1`; `delayMs` більше
      за таймаут клієнта (`AbortSignal.timeout`) → `abandoned: 1`. Запуск:
      `node --test 'perf/openai-mock/*.test.mjs'`. Спершу тест червоний.
- [ ] Реалізація, тест зелений.
- [ ] `deploy/chaos/openai-mock.yaml`: Deployment (1 репліка, `node:24-alpine`,
      `command: [node, /app/server.mjs]`, readiness `/health`, ресурси 50m/64Mi), Service
      `openai-mock:8080`. ConfigMap створює раннер:
      `kubectl create configmap openai-mock --from-file=perf/openai-mock/server.mjs --dry-run=client -o yaml | kubectl apply -f -`.
- [ ] Коміт `feat(chaos): openai-mock for the dub provider`.

## Задача 4. k6 `perf/k6/chaos.js`

- [ ] Фікстура `perf/k6/fixtures/chaos.mp4`: 10 с, 640×360, тон 440 Гц (`-f lavfi -i sine`),
      генерується в раннері, як `fixture()` у `autoscale-demo.sh`; рядок у `.gitignore`.
- [ ] Env: `API_KEY`, `RUN` (префікс ключа), `RATE` (5/с), `DURATION` (5m), частки
      `FRAMES_SHARE` (0.08) і `DUB_SHARE` (0.02); решта — `image.resize`.
- [ ] `setup()`: завантажити PNG і `chaos.mp4` (`uploadFile`). Upload без ключа ідемпотентності,
      тож `setup` іде до вмикання збою.
- [ ] Ітерація (`constant-arrival-rate`): ключ `${RUN}-${exec.scenario.iterationInTest}`, до 6
      спроб із backoff 1, 2, 4, 8, 8 с (або `Retry-After`) на мережевій помилці, `5xx` і `429`.
      Лічильники: `chaos_accepted`, `chaos_gave_up`, `chaos_retries`, `chaos_key_mismatch`
      (повтор повернув інший `jobId`), `chaos_rejected_4xx` (окрім 409/429 — баг навантаження,
      поріг 0).
- [ ] `--summary-export` у `perf/reports/raw/stage-6/<run>/k6.json`.
- [ ] Перевірка без збою: `scripts/chaos.sh baseline` (задача 6) — `chaos_gave_up` 0.
- [ ] Коміт `feat(perf): chaos load`.

## Задача 5. Аудитор `scripts/chaos-audit.mjs`

Вхід: `--run <id> --user <uuid> --since <iso> --scenario <name> --dir <raw dir>`. SQL —
через `kubectl -n pdp exec -i postgres-1 -c postgres -- psql -d metadata -tA --csv`.

| Метрика                | Запит / джерело                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `jobs`                 | медіа-задачі користувача: `type <> 'webhook.deliver'`                                                                |
| `lost`                 | медіа-задачі не в `succeeded/dead/failed`; `chaos_accepted` k6 мінус кількість рядків `idempotency_keys` користувача |
| `dup_keyless`          | медіа-задачі без рядка в `idempotency_keys`                                                                          |
| `dup_succeeded_twice`  | `job_executions` з `outcome = 'succeeded'` більше одного на задачу                                                   |
| `dup_webhook`          | `webhook.deliver` більше одного на `(jobId, type)`                                                                   |
| `lost_webhook`         | завершена медіа-задача без `webhook.deliver` на свою подію                                                           |
| `dup_paid`             | `paid` транскрипцій мінус dub-задачі, що пройшли транскрипцію; так само для перекладу                                |
| `dup_key_mismatch`     | `chaos_key_mismatch` з k6                                                                                            |
| `dead`, `dead_reasons` | `status = 'dead'`, групування за `dead_reason`                                                                       |
| `caught`               | приріст `jobs_duplicates_total` за `source` з VictoriaMetrics                                                        |
| `p95_e2e_s`            | `percentile_cont(0.95)` від `finished_at - created_at`                                                               |

Підсумок: `duplicates_permille = 1000 * сума dup_* / jobs`, `dlq_percent = 100 * dead / jobs`,
`pass = lost == 0 && lost_webhook == 0 && duplicates_permille < 0.1 && dlq_percent < 1`.

- [ ] Чисті функції підрахунку (`summarize(rows) → result`) окремо від I/O; тест
      `scripts/chaos-audit.test.mjs` на `node:test` з підготовленими рядками: чистий прогін,
      дублікат вебхука, загублена задача, повторна оплата. Спершу червоний.
- [ ] I/O: SQL, `kubectl exec deploy/openai-mock -- wget -qO- localhost:8080/calls`, k6 JSON, VM.
- [ ] Вихід: `audit.json` у теці прогону і рядок Markdown-таблиці в stdout; код виходу 1, якщо
      `pass` хибний.
- [ ] Коміт `feat(perf): chaos audit`.

## Задача 6. Раннер `scripts/chaos.sh`

```
scripts/chaos.sh baseline            # без збою, перевірка навантаження й аудиту
scripts/chaos.sh 01-worker-kill      # один сценарій
scripts/chaos.sh all                 # усі по черзі, підсумкова таблиця
scripts/chaos.sh --target aws all    # етап 8: kube-context EKS, ingress домену
```

На сценарій (~10 хв):

1. Свіжий користувач `chaos-<scenario>-<час>` через `seedUser` з відомим ключем
   `pdp_chaos_<час>_local`; вебхук на `http://webhook-receiver:3000/ok` для `job.succeeded` і
   `job.dead` через `POST /v1/webhooks`.
2. `openai-mock` застосований і готовий, `DELETE /calls`, `DELETE /faults`; `video-dub` —
   `kubectl set env DUB_PROVIDERS=openai OPENAI_BASE_URL=http://openai-mock:8080/v1
DUB_TTS=fake DUB_AUDIO_SEPARATE=fake` і ключ `sk-chaos` (secret `dub-provider`), якщо ще не
   так; відновлюється в `trap` на виході.
3. k6 у фоні; на 60-й секунді — `kubectl apply -f deploy/chaos/<scenario>.yaml` (тривалість
   збою — у самому маніфесті, `duration`); для сценарію 8 — `PUT /faults`.
4. Проби під час збою, кожні 2 с у `probes.csv`: `GET /health/ready` gateway, `POST /v1/jobs`
   статус, для сценарію 5 — `POST /v1/auth/login` з паролем користувача прогону (очікування —
   `503`, не `500`).
5. Після k6 — `kubectl delete -f` маніфесту, чекати лаг консюмерів 0 (`lag()` з
   `autoscale-demo.sh`) і жодної незавершеної задачі користувача, максимум 15 хв.
6. `node scripts/chaos-audit.mjs …`; `all` збирає рядки в `perf/reports/raw/stage-6/summary.md`.

- [ ] `sql` і `lag` — копії з `autoscale-demo.sh`: спільна бібліотека bash заради двох коротких
      функцій не варта того.
- [ ] `--target aws`: контекст `pdp`, `BASE_URL=https://api.<домен>`, Postgres — через
      `psql` у поді Metadata замість `postgres-1`. Реалізація — у підсумковій AWS-сесії; тут лише
      розбір аргументу і помилка «not yet».
- [ ] `shellcheck scripts/chaos.sh`; `scripts/chaos.sh baseline` проходить: `pass`, `lost 0`.
- [ ] Коміт `feat(scripts): chaos runner`.

## Задача 7. Сценарії `deploy/chaos/`

Кожен файл — один або кілька об'єктів Chaos Mesh у namespace `pdp`, `duration` 60–120 с,
селектори за `app.kubernetes.io/name` (або NetworkPolicy, якщо так вирішив spike).

| Файл                         | Об'єкт                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `01-worker-kill.yaml`        | `Schedule` + `PodChaos pod-kill` кожні 20 с: `worker-cpu`, `video-frames`, `video-dub` по одному |
| `02-control-kill.yaml`       | `Schedule` pod-kill `api-gateway`, `metadata`, `scheduler`                                       |
| `03-nats-kill.yaml`          | `PodChaos pod-kill` `nats-0`                                                                     |
| `04-postgres-partition.yaml` | `NetworkChaos partition` `pdp` → под `postgres-1`, 60 с                                          |
| `05-redis-partition.yaml`    | `NetworkChaos partition` до Redis, 60 с                                                          |
| `06-net-degrade.yaml`        | `NetworkChaos delay 200ms jitter 50ms` + `loss 5%` між подами `pdp`, 120 с                       |
| `07-worker-oom.yaml`         | `StressChaos` пам'яті понад ліміт `worker-cpu`                                                   |
| `08-openai-faults.json`      | не Chaos Mesh: тіло `PUT /faults` (500 на 30%, далі 429, далі затримка понад таймаут)            |
| `09-audio-separate.yaml`     | `PodChaos pod-failure` `audio-separate`; лише AWS — див. нижче                                   |
| `10-minio-partition.yaml`    | `NetworkChaos partition` до MinIO, 60 с                                                          |

Сценарій 9: у k3d `audio-separate` вимкнено (образ 6 ГБ, а справжнє розділення на CPU ноутбука
займає хвилини на кліп). Фейк по HTTP мав би читати й писати S3, як `FakeAudioSeparate`, тобто
ще один сервіс заради одного сценарію. Тому в k3d сценарій 9 не ганяється: поведінку клієнта
покривають unit-тести `AudioSeparateClient` (чекає на `503` і `ECONNREFUSED` до таймауту), а сам
сценарій — у підсумковій AWS-сесії, де `audio-separate` справжній.

- [ ] По одному коміту на групу маніфестів, кожен перевірено `kubectl apply --dry-run=server`.
- [ ] Коміт `feat(chaos): failure scenarios`.

## Задача 8. Прогони і виправлення

- [ ] `scripts/chaos.sh all`; на кожен невдалий сценарій — причина за логами (VictoriaLogs) і
      трейсами, виправлення з тестом окремим комітом `fix(...)`, повторний прогін сценарію.
- [ ] Перевірити поведінку при недоступному Redis і Postgres за `probes.csv` і записати в
      `stage-6.md` (критерій етапу).

## Задача 9. Grafana

- [ ] Панелі в дашборді pipeline: «DLQ, % проти 1%» (`increase(jobs_dlq_total)` /
      `increase(jobs_finished_total)` з порогом 1%) і «Перехоплені дублікати за джерелом»
      (`sum by (source) (increase(jobs_duplicates_total[5m]))`).
- [ ] Знімки панелей під час прогону `all` — у `perf/reports/stage-6/`.
- [ ] Коміт `feat(observability): chaos panels`.

## Задача 10. Документи

- [ ] `docs/plan/stage-6.md`: чекбокси 6.1, результат spike.
- [ ] Чернетка `perf/reports/stage-6.md`: таблиця сценаріїв k3d з `summary.md`, методика;
      фінальна версія — у «Завершенні етапу».
- [ ] Коміт `docs: chaos scenarios in k3d`.

## Результат spike

21 жовтня 2026, k3d `rancher/k3s:v1.35.5-k3s1`, Docker Desktop (12 CPU, 12.6 ГБ), Chaos Mesh
2.8.5. Усі чотири типи працюють, NetworkPolicy як запасний варіант не потрібна.

| Збій                                         | Результат                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `PodChaos pod-kill` `worker-cpu`             | под перестворено за секунди                                                  |
| `NetworkChaos delay 200ms` без `target`      | запит `worker-cpu` → Metadata 33 → 650 мс (DNS, TCP і запит, кожен +200 мс)  |
| `NetworkChaos delay` з `target: metadata`    | **не діє**: `AllInjected=True`, а затримки немає                             |
| `NetworkChaos partition` Postgres → поди app | readiness Metadata падає за ~15 с, повертається після зняття, Postgres живий |
| `StressChaos memory 2GB` на ліміт 512Mi      | контейнер `worker-cpu` — `OOMKilled`, рестарт                                |

Чому `target` не діє: у мережевому просторі пода-клієнта пакет іде на ClusterIP сервісу, DNAT на
IP пода робить вузол уже за межами пода, а Chaos Mesh фільтрує за IP подів цілі. Тому:

- **розриви до Postgres, Redis, MinIO** — з боку сервера: `selector` — под сервера, `target` —
  поди застосунку (`app.kubernetes.io/part-of: pdp-media-pipeline`), `direction: to`. Відповіді
  сервера йдуть прямо на IP пода, без ClusterIP, тож фільтр спрацьовує, а проби kubelet з вузла —
  ні, і сервер не перезапускається;
- **затримка і втрата між сервісами** — без `target`, на весь вихідний трафік подів застосунку.

Перший `helm install` застосунку в `scripts/k8s.sh up` упав на гонці з HPA (`Deployment generation
is 2, but latest observed generation is 1`), хоча поди піднялися; повторний `scripts/k8s.sh deploy`
довів реліз до `deployed`. Не з Chaos Mesh; якщо повториться — окреме виправлення.
