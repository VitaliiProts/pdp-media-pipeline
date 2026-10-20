# Етап 5b. AWS, домен і перший деплой з CI

- Тижні 24–25: 22 березня – 4 квітня 2027 (після етапів 5c і 5d, [план](stages-5c-5d.md); у PDF —
  тижні 16–17). Етапи 0–5d закриті з випередженням приблизно на 5 місяців, тож починати можна
  одразу
- Статус: готово 20 жовтня 2026 (план деталізовано 19 жовтня після навантажувального тесту 5d).
  Етап розбито на три PR:
  - **5b.1 «Доступ, Terraform-база і домен»**, гілка `feature/stage-5b.1-terraform-base`;
  - **5b.2 «Код і Helm під AWS, EKS»**, гілка `feature/stage-5b.2-eks`;
  - **5b.3 «Деплой з CI»**, гілка `feature/stage-5b.3-deploy-ci`.

## Результат і критерій

**Результат:** система працює в AWS на домені `pdp-media-pipeline.online` через HTTPS, а merge у
`main` автоматично деплоїть нову версію. Наступні етапи (chaos, canary, перформанс) йдуть уже на
цьому кластері.

**Готово, коли:**

- `https://api.pdp-media-pipeline.online` і `https://app.pdp-media-pipeline.online` відповідають з валідним
  сертифікатом Let's Encrypt, а `pdp-media-pipeline.online` і `www.` переадресовують на `app.`;
- інфраструктура піднімається з нуля через `terraform apply`, а `aws.sh down` не лишає платних
  ресурсів, крім базового шару;
- merge у `main` без ручних дій доходить до AWS і проходить smoke-тест. Canary і rollback — Етап 7;
- дубляж понад загальний місячний ліміт системи отримує `429`, і за місяць неможливо витратити на
  OpenAI більше за цей ліміт.

## Що вже є

- Helm: library-чарт `pdp-lib`, umbrella `pdp` з `values-dev.yaml` і `values-prod.yaml`
  (Ingress для `api.` і `app.`, `TRUST_PROXY_HOPS`, мінімум 2 репліки), чарт `platform`
  (NATS, Redis з AOF і PVC, MinIO, CloudNativePG, observability). Міграції — Job з хуком
  `pre-install,pre-upgrade`. Чарти `video-worker` (Deployment `video-dub`) і `audio-separate`
  з NetworkPolicy (Етап 5d).
- Автоскейл KEDA за лагом консюмерів, зокрема до нуля (`minReplicas: 0`, `activationLagThreshold`),
  HPA gateway, PDB, anti-affinity, graceful shutdown (ADR-012).
- CI: `verify`, `test` (Jest і Vitest), `integration` (поріг покриття 80% рядків, інструкцій і
  функцій), `audio-separate` (ruff і pytest), `audit`, `helm`, `alert-rules`, `docker` (збирає 9
  образів без push, Trivy у режимі звіту).
- `scripts/k8s.sh` для k3d, `scripts/e2e-smoke.sh` для compose і k3d.
- Навантаження дубляжу ([звіт](../../perf/reports/stage-5d.md)): один под `audio-separate`
  (2 CPU, 4 ГБ на піку) і два `video-dub` дають 74 дубляжі на годину, $0.018 за хвилину.
- AWS-акаунт `186712718120` (Етап 0): root з MFA і без ключів, бюджет `pdp-monthly` $15 з
  алертами на email, план Paid. Профіль `default` в `~/.aws` — робочий акаунт, для PDP не
  використовується.
- Домен `pdp-media-pipeline.online` зареєстрований у GoDaddy 19 жовтня 2026 (до 19 жовтня 2027),
  DNS поки в GoDaddy (`ns49/ns50.domaincontrol.com`), DNSSEC вимкнений, інших записів і сайту
  немає.

## Що треба змінити в наявному коді

- **S3 без статичних ключів.** `s3EnvSchema` вимагає `S3_ENDPOINT`, `S3_ACCESS_KEY` і
  `S3_SECRET_KEY`, gateway — ще й `S3_PUBLIC_ENDPOINT`, `audio-separate` читає ті самі змінні. В
  AWS ключів немає: SDK бере облікові дані з ролі пода. Endpoint'и й ключі стають необовʼязковими
  (ключі — обидва або жодного), `S3_FORCE_PATH_STYLE=false`; presign — на регіональний endpoint S3.
- **TLS до RDS.** RDS PostgreSQL 17 вимагає TLS (`rds.force_ssl=1`). `DATABASE_URL` з
  `sslmode=verify-full` і CA-бандлом RDS (публічний файл, монтується з ConfigMap); перевірити, що
  `pg` у Metadata і `migrate.ts` його приймають.
- **ServiceAccount на сервіс.** Усі поди зараз під `default` ServiceAccount, а Pod Identity видає
  роль саме ServiceAccount'у: без окремих акаунтів доступ до S3 отримав би кожен под. `pdp-lib`
  створює ServiceAccount на сервіс; `automountServiceAccountToken: false` лишається — агент Pod
  Identity монтує свій токен окремо (перевірити на першому деплої).
- **Egress до агента Pod Identity.** `_network.tpl` забороняє `169.254.0.0/16`, а агент слухає
  `169.254.170.23:80`. `video-dub` і `audio-separate` під NetworkPolicy інакше лишаться без
  облікових даних AWS. Плюс `audio-separate` в AWS ходить у S3 назовні (`egressPublicHttps`).
- **Платформа без Postgres і MinIO.** У `platform` — `postgres.enabled` і `minio.enabled`; в AWS
  обидва вимкнені, PVC для NATS, Redis і observability — на `gp3` (EBS CSI).
- **Grafana без публічної адреси.** Як і локально, анонімна, але лише через
  `aws.sh grafana` (`kubectl port-forward` на `localhost:3000`): для демо не потрібні ні логін, ні
  ще один сертифікат. `GRAFANA_URL=http://localhost:3000` — посилання на трейси з UI працюють у
  того, у кого запущений port-forward.
- **Розміри під вузли.** `values-prod.yaml` на мінімумах просить 13.7 CPU і 15.3 ГіБ, а два
  `m7i.xlarge` дають ≈7.8 CPU під поди. `values-aws.yaml` ставить по одній репліці, а
  `video-dub` і `audio-separate` масштабує від нуля (див. [бюджет ресурсів](#бюджет-ресурсів)).
- **Загальний ліміт дубляжу.** Реєстрація відкрита, а квота (`DUB_QUOTA_SECONDS`, 30 хв на місяць)
  рахується на користувача: сто акаунтів — сто квот на ключ OpenAI. Потрібен ще ліміт на всю
  систему (див. 5b.2).

## Що додають етапи 5c і 5d

- **Redis із сесіями.** AOF і PVC уже є (5c). PVC живе, поки живе кластер: сесії переживають
  рестарт пода, але не `aws.sh down`, після нього всі входять знову. ElastiCache в ADR-017
  порівнюється з цим.
- **S3.** Оригінали зберігаються навмисно (медіатека). Завантаження, з яких не створили задачу,
  прибирає janitor Metadata, а не lifecycle-правило (ADR-014); об'єкти видаляє воркер через роль
  пода (`s3:ListBucket`, `s3:DeleteObject`). CORS потрібен і для субтитрів: `<track>` вантажить
  VTT із S3 з перевіркою CORS.
- **Ключ провайдера дубляжу.** Не в репозиторії, не в values і не в state Terraform: Terraform
  створює SSM SecureString із заглушкою (`ignore_changes` на значення), справжній ключ вносите ви
  через `aws ssm put-parameter --overwrite`. `aws.sh up` робить з нього Secret `dub-provider`
  (`aws ssm get-parameter` → `kubectl apply`), тож ключ не проходить і через state шару `cluster`.
- **`video-dub` і `audio-separate`.** Образи 1.9 і 5.9 ГБ у розпакованому вигляді: диск вузла
  80 ГБ замість 20 за замовчуванням. Egress `video-dub` — лише `443` назовні (network policy у
  `vpc-cni`).
- **Вхід за доменом.** Cookie сесії з `Secure` і без атрибута `Domain` (вже так): вона належить
  лише `app.pdp-media-pipeline.online` і не потрапляє на `api.`. `APP_ORIGINS` —
  `https://app.pdp-media-pipeline.online`.

## Прийняті рішення

| Питання          | Рішення                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Домен            | `pdp-media-pipeline.online` (GoDaddy) повністю в Route 53: hosted zone у базовому шарі, у GoDaddy — власні nameservers з виходу Terraform. Хости `api.` і `app.`; корінь і `www.` переадресовують на `app.` (Traefik)                                              |
| Кластер          | EKS, managed node group: 2 × `m7i.xlarge` (4 vCPU, 16 ГБ), on-demand, диск 80 ГБ `gp3`. Обґрунтування й вартість — ADR-017 (у PDF — ADR-010). k3s на EC2 і EKS Auto Mode — в альтернативах                                                                         |
| Розміщення       | По одній репліці кожного сервісу; `video-dub` 0–2 і `audio-separate` 0–1 з масштабуванням від нуля: перший дубляж після простою чекає на старт пода (≈1–2 хв, перше витягування образу на вузол — довше)                                                           |
| Режим роботи     | Кластер піднімається під роботу й демо і знищується; постійний лише дешевий базовий шар. RDS між сесіями зупиняється                                                                                                                                               |
| Регіон           | `eu-central-1`                                                                                                                                                                                                                                                     |
| Дані             | RDS PostgreSQL 17 (`db.t4g.micro`, 20 ГБ gp3, приватні підмережі), S3 замість MinIO. Redis і NATS JetStream — у кластері, як локально. ElastiCache — в альтернативах ADR                                                                                           |
| Мережа           | VPC з публічними й приватними підмережами в 2 AZ, **без NAT Gateway** (~$35/міс): вузли в публічних підмережах з security group, RDS — у приватних. Gateway endpoint для S3 (безкоштовний)                                                                         |
| Ролі для подів   | EKS Pod Identity: асоціації переживають перестворення кластера без зміни trust policy. ServiceAccount на сервіс. IRSA — в альтернативах                                                                                                                            |
| Ingress          | Traefik (той самий, що в k3d) за NLB, який створює AWS Load Balancer Controller. ingress-nginx не беремо: проєкт знято з підтримки                                                                                                                                 |
| TLS і DNS        | cert-manager з Let's Encrypt (DNS-01 через Route 53), external-dns створює записи з Ingress лише в зоні `pdp-media-pipeline.online`                                                                                                                                |
| Terraform        | `deploy/terraform`: `bootstrap` (S3-бакет для state, локальний state), `base` (постійний), `cluster` (на вимогу). State у S3 з нативним блокуванням (`use_lockfile`, Terraform ≥ 1.11), модулі `terraform-aws-modules` з фіксованими версіями                      |
| Образи           | ECR, 8 репозиторіїв (без `webhook-receiver`), теги незмінні. Сервіси — тег SHA коміту, зберігаються 10 останніх. `audio-separate` — тег за вмістом `apps/audio-separate` (`git rev-parse HEAD:apps/audio-separate`), збирається лише коли змінився, зберігаються 3 |
| Витрати OpenAI   | Загальний ліміт секунд дубляжу на місяць на всю систему в Metadata (`DUB_SYSTEM_QUOTA_SECONDS`); в AWS — 18 000 с (300 хв, ≈ $5.4 на місяць). Квота на користувача лишається                                                                                       |
| Локальний доступ | IAM Identity Center (інстанс організації, один регіон), профіль `pdp`; без IAM-ключів                                                                                                                                                                              |
| Секрети          | Пароль RDS — `random_password` у Terraform → SSM SecureString; `aws.sh up` створює Secret `postgres-app` (ключ `uri`) з тим самим іменем, що дає CloudNativePG локально                                                                                            |
| CI → AWS         | GitHub OIDC, роль лише для `repo:VitaliiProts/pdp-media-pipeline:environment:aws`; environment `aws` дозволений лише для `main`. Права: push в ECR, `eks:DescribeCluster`, читання `/pdp/prod/*`, access entry лише на namespace `pdp`                             |
| Параметри        | Terraform пише виходи (домен, бакет, ARN, endpoint RDS) в SSM Parameter Store `/pdp/prod/*`; CI пише туди ж останній задеплоєний тег. `scripts/aws.sh` і CI читають звідти, у репозиторії нічого не копіюється                                                     |

## Бюджет ресурсів

Requests на двох вузлах (≈7.8 CPU і ≈29 ГіБ під поди):

| Що                                                                                                                                          | CPU  | Пам'ять  |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------- |
| Системні: `vpc-cni`, `kube-proxy`, CoreDNS, EBS CSI, Pod Identity, LB Controller, Traefik, cert-manager, external-dns, KEDA, metrics-server | ≈1.2 | ≈1.5 ГіБ |
| Платформа: NATS, Redis, observability                                                                                                       | 0.4  | 0.9 ГіБ  |
| Сервіси на мінімумах: gateway, Metadata, scheduler, web, три класи воркерів, `video-frames`, `video-transcode`                              | 2.4  | 2.2 ГіБ  |
| **У простої**                                                                                                                               | ≈4.0 | ≈4.6 ГіБ |
| Під час дубляжу: `video-dub` + `audio-separate`                                                                                             | +3.0 | +5 ГіБ   |
| Другий под `video-transcode` під час дубляжу                                                                                                | +1.0 | +0.8 ГіБ |

Простій і один дубляж вміщаються з запасом ≈0.8 CPU. Якщо під час дубляжу черга транскодингу
підніме другий под, він чекатиме в `Pending`, поки дубляж не завершиться: задача стоїть у черзі,
нічого не губиться. Максимуми в `values-aws.yaml`: `video-transcode` і `video-frames` — 2,
воркери — 2, gateway — 3.

## Вартість (оцінка, уточнюється в ADR-017 через AWS Pricing Calculator)

| Що                                             | Коли кластер працює | Коли вимкнений       |
| ---------------------------------------------- | ------------------- | -------------------- |
| EKS control plane                              | ~$0.10 / год        | —                    |
| 2 × `m7i.xlarge`, 2 × 80 ГБ gp3, публічні IPv4 | ~$0.52 / год        | —                    |
| NLB                                            | ~$0.03 / год        | —                    |
| RDS `db.t4g.micro`                             | ~$0.02 / год        | лише диск, ~$3 / міс |
| Route 53 zone, ECR, S3, SSM, state             | —                   | ~$1–2 / міс          |
| **Разом AWS**                                  | **~$0.67 / год**    | **~$4–5 / міс**      |
| OpenAI (загальний ліміт)                       | до ~$5.4 / міс      | —                    |

Бюджет — $15 на місяць з повідомленнями на 50% і 80% фактичних витрат і 100% прогнозу. Жорсткого
ліміту AWS не має, а дані про витрати оновлюються із затримкою до доби, тож бюджет — сигнал, а не
вимикач: після базового шару на кластер лишається ≈ $10, тобто ≈ 15 годин на місяць, і кластер
піднімається лише під конкретну роботу. OpenAI в бюджет не входить: його тримають загальний ліміт
дубляжу й передплачений баланс без автопоповнення.

## Підетап 5b.1. Доступ, Terraform-база і домен

Найдовше тут — чекання поширення NS, тому зона Route 53 і зміна nameservers ідуть першими, а код
5b.2 пишеться, поки вони поширюються.

**Ручні кроки (робите ви, я підказую по ходу):**

- [x] **IAM Identity Center.** Доступ до акаунта через Identity Center дає лише інстанс організації,
      тому спершу — AWS Organizations (поточний акаунт стає management account). Потім:
      Identity Center у `eu-central-1` (Single-Region, ключ AWS — без оплати KMS), користувач з
      MFA, permission set `AdministratorAccess` (сесія 8 год), призначення на акаунт. Зроблено
      19 жовтня.
- [x] Профіль `pdp` в `~/.aws/config` (`sso-session pdp`); `aws sso login --profile pdp`;
      `aws sts get-caller-identity` показує роль `AWSReservedSSO_AdministratorAccess_*`.
- [x] IAM-користувач `vitalii` з Етапу 0 (`AdministratorAccess`, пароль і MFA) лишається
      аварійним входом у консоль на випадок збою Identity Center; access keys йому не
      створюються, щоденна робота — лише через SSO.
- [x] Terraform 1.16.6 — бінарник HashiCorp з перевіркою SHA256 у `~/.local/bin` (Homebrew
      вимагає Command Line Tools для Xcode 27).
- [x] Квота On-Demand vCPU у `eu-central-1` — 5, а два `m7i.xlarge` займають 8: запит на 16
      (два вузли й заміна вузла під час оновлення) подано й схвалено 19 жовтня.
- [x] Після `apply` базового шару — у GoDaddy: домен → DNS → Nameservers → «Change» → «I'll use
      my own nameservers», чотири значення з виходу `name_servers`. Записи в DNS GoDaddy після
      цього не діють: усе живе в Route 53. Зроблено 19 жовтня: сервери `.online` і публічні
      резолвери (1.1.1.1, 8.8.8.8, 9.9.9.9) віддають Route 53 через ≈12 хв після збереження.
- [ ] Автопродовження домену в GoDaddy: реєстрація до 19 жовтня 2027, захист — у квітні 2027;
      ціна продовження `.online` помітно вища за першу.

**Код:**

- [x] `deploy/terraform/bootstrap`: S3-бакет для state (versioning, шифрування, Block Public
      Access, заборона запитів без TLS); state самого bootstrap — локальний, у `.gitignore`.
- [x] `deploy/terraform/base` (`versions.tf`, `dns.tf`, `network.tf`, `database.tf`, `storage.tf`,
      `services.tf`, `ssm.tf`, `github.tf`, `budget.tf`, `outputs.tf`). RDS — за прапорцем
      `database_enabled`, вмикається в день першого кластера:
  - hosted zone `pdp-media-pipeline.online`; CAA — `letsencrypt.org` і `amazon.com` (для
    запасного варіанта з ACM), без них сертифікат може випустити будь-який центр;
  - VPC: 2 AZ, публічні й приватні підмережі з тегами для LB Controller, без NAT, S3 gateway
    endpoint;
  - security group `pdp-nodes` без правил: шар `cluster` чіпляє її до вузлів, а RDS пускає лише
    з неї. Інакше RDS посилався б на групу, яка зникає з кожним `down`;
  - RDS PostgreSQL 17: приватні підмережі, `rds.force_ssl=1`, бекапи 1 день,
    `deletion_protection`, пароль — `random_password` → SSM SecureString;
  - S3-бакет медіа: Block Public Access, шифрування, CORS `GET`, `PUT`, `HEAD` для
    `https://app.pdp-media-pipeline.online` з `ETag` у `ExposeHeaders`; без lifecycle для `uploads/`
    (ADR-014);
  - ECR: 8 репозиторіїв, `IMMUTABLE`, lifecycle — 10 останніх образів, для `audio-separate` — 3,
    неперелічені теги — день;
  - SSM SecureString `/pdp/prod/openai-api-key` із заглушкою й `ignore_changes`;
  - GitHub OIDC provider і роль `pdp-deploy` (trust — `sub` з `environment:aws`);
  - AWS Budgets: бюджет `pdp-monthly` з Етапу 0 імпортується (`import`), $15, email — у
    `terraform.tfvars` поза репозиторієм;
  - параметри `/pdp/prod/*`: домен, зона, бакет, endpoint RDS, ARN ролей, реєстр ECR.
- [x] CI: job `terraform` — `terraform fmt -check` і `init -backend=false && validate` для трьох
      шарів, Trivy в режимі `config` (звіт, як для образів). Свідомі відступи — шифрування без
      власного ключа KMS і публічні адреси вузлів — позначені `#trivy:ignore` з причиною.
- [x] ADR-017 «Де запускати кластер»: EKS проти k3s на EC2 і EKS Auto Mode, Pod Identity проти
      IRSA, Redis у кластері проти ElastiCache (з урахуванням сесій), NAT проти публічних
      підмереж; вартість на місяць для «постійно» і
      «на вимогу».
- [x] Таблиця відповідності ADR номерам PDF: 010 → 017.

**Перевірити:**

- `terraform plan` після `apply` — без змін;
- `dig NS pdp-media-pipeline.online` повертає nameserver'и Route 53, `dig +trace` доходить до них
  від сервера `.online`;
- тестовий TXT у зоні Route 53 видно через `dig TXT test.pdp-media-pipeline.online`, потім його
  прибрати; `dig CAA` показує обидва центри;
- лист від AWS Budgets про створений бюджет.

**Коміти:** `ci: terraform fmt and validate` → `infra(terraform): state bucket` →
`infra(terraform): base layer — zone, VPC, RDS, S3, ECR` → `infra(terraform): GitHub OIDC,
budget and SSM parameters` → `docs: ADR-017 where the cluster runs`.

## Підетап 5b.2. Код і Helm під AWS, EKS

Код і Helm перевіряються в k3d до першого `apply` кластера: година EKS коштує, а цикл
`apply`/`destroy` займає ~30 хв.

**Код:**

- [x] S3 без ключів: `libs/config/src/schemas.ts` (endpoint і ключі необовʼязкові, ключі — разом),
      `libs/worker-kit/src/object-storage.ts`, `apps/api-gateway/src/config.ts` і
      `storage/storage.service.ts` (`S3_PUBLIC_ENDPOINT` необовʼязковий: без нього presign на
      регіональний endpoint), `apps/audio-separate/audio_separate/{main,storage}.py` (boto3 без
      ключів бере облікові дані сам). Тести на обидва режими: з MinIO і без ключів.
- [x] TLS до RDS: `DATABASE_URL` з `sslmode=verify-full&sslrootcert=/etc/rds/ca.pem` у Metadata і
      Job міграцій. Код не змінюється: `pg` (`pg-connection-string` 2.14) сам читає CA з
      `sslrootcert` і перевіряє ланцюжок та імʼя хоста. Перевірено 19 жовтня на Postgres 17 з TLS
      у Docker: свій CA — TLS 1.3, чужий CA — `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, IP замість імені з
      сертифіката — `ERR_TLS_CERT_ALTNAME_INVALID`. Справжня перевірка — на RDS.
- [x] Загальний ліміт дубляжу:
  - `DUB_SYSTEM_QUOTA_SECONDS` у `apps/metadata/src/config.ts`, `0` — без ліміту (локально нічого
    не змінюється);
  - `assertDubQuota` після блокування користувача бере `pg_advisory_xact_lock` ліміту системи й
    рахує ті самі секунди по всіх користувачах; понад ліміт — `429` з кодом
    `DUB_SYSTEM_QUOTA_EXCEEDED` (`libs/contracts`). Блокування одне на всю систему: дубляжі
    створюються рідко, черга на ньому — мілісекунди;
  - `GET /v1/dub-quota`: `remainingSeconds` — менший із двох залишків, `systemLimited` — коли це
    спільний; діалоги перекладу показують залишок спільного часу і «спільного для всіх часу не
    вистачає», кнопка неактивна;
  - тести: інтеграційний на Postgres (два користувачі разом перевищують ліміт; поки тест тримає
    блокування, жоден із двох паралельних запитів не завершується, потім проходить один — без
    блокування в коді тест падає), Vitest на модель і діалог.
- [x] `pdp-lib`: ServiceAccount на сервіс (імʼя — як у сервісу, токен API не монтується); у
      `_network.tpl` — `egressPodIdentity` (`169.254.170.23/32:80`). Рендер перевіряє
      `helm-check.sh` разом з AWS-профілем.

**Helm:**

- [x] `platform/values-aws.yaml`: без Postgres, MinIO та Ingress платформи, PVC — на StorageClass
      за замовчуванням (`gp3`), Grafana без Ingress, `vmalert` посилається на `localhost:3000`.
- [x] `pdp/values-aws.yaml` поверх `values-prod.yaml`: реєстр ECR, хости `api.`, `app.` і
      Ingress кореня з `www.` з Middleware `redirectRegex` на `app.` (`templates/redirect.yaml`),
      анотації Traefik на `websecure` з TLS, S3 через роль (лише бакет і регіон, без endpoint і
      ключів), `DATABASE_URL` з Secret `postgres-app` і ConfigMap `rds-ca` у `/etc/rds` для
      Metadata і Job міграцій, мінімуми й максимуми з [бюджету](#бюджет-ресурсів), `video-dub`
      0–2 і `audio-separate` 0–1 з `egressPodIdentity` (`audio-separate` — ще
      `egressPublicHttps` до S3), `DUB_SYSTEM_QUOTA_SECONDS=18000`,
      `GRAFANA_URL=http://localhost:3000`. Теги образів (і окремий для `audio-separate`) дає
      `aws.sh`. Requests на мінімумах: 2.33 CPU і 2.25 ГіБ сервіси, 0.37 CPU і 0.75 ГіБ
      платформа.
- [x] `helm-check.sh` рендерить AWS-профіль і падає, якщо щось ще посилається на MinIO або
      `video-dub` і `audio-separate` не мають `egressPodIdentity`. Розміщення на двох вузлах і
      холодний старт перевіряються на першому `up`, без окремих замірів у k3d.

**Terraform, шар `cluster`:**

Лише ресурси AWS. Helm-релізи й об'єкти Kubernetes ставить `aws.sh up`: провайдери `helm` і
`kubernetes` в одному `apply` з кластером, якого ще немає на `plan`, ненадійні, а Secret з
ключем OpenAI, зроблений Terraform, лишив би ключ у state.

- [x] EKS 1.37 (`terraform-aws-modules/eks` 21.29.0) — найновіша зі standard support, до грудня
      2027; публічний endpoint API з автентифікацією IAM (`authentication_mode = API`), без
      IRSA, без власного KMS-ключа й логів control plane в CloudWatch; node group 2 ×
      `m7i.xlarge` (AL2023, максимум 3 на час оновлення), диск 80 ГБ `gp3`, групи вузлів —
      `pdp-nodes` з базового шару й група модуля з тегом `kubernetes.io/cluster/pdp` (LB
      Controller вимагає рівно одну таку). Що базовий шар віддав, шар читає з SSM `/pdp/prod/*`,
      не з його state.
- [x] Addons: `vpc-cni` з network policy, `kube-proxy` і `eks-pod-identity-agent` до вузлів,
      `coredns` і `aws-ebs-csi-driver` після; `bootstrap_self_managed_addons = false`.
- [x] Access entries: адміністратор (роль SSO, ARN без шляху через `aws_iam_roles`) —
      `AmazonEKSClusterAdminPolicy`; роль деплою — `AmazonEKSAdminPolicy` лише в namespace `pdp`
      (чи вистачає прав на ресурси CRD — `ScaledObject`, `Middleware` — перевіряється в 5b.3).
- [x] Pod Identity (`terraform-aws-modules/eks-pod-identity` 2.10.0): `pdp-media` для gateway,
      `video-*`, `audio-separate` (`ListBucket`, `Get/PutObject`, `AbortMultipartUpload`),
      `pdp-media-purge` для трьох класів воркерів (те саме й `DeleteObject`); external-dns і
      cert-manager — лише зона `pdp-media-pipeline.online`; LB Controller; EBS CSI.
- [x] Trivy: чотири прийняті знахідки позначені в `eks.tf` з причиною — публічний API (два
      правила), egress вузлів, шифрування Secrets ключем AWS.
- [x] `validate` і `plan` проти акаунта: 63 ресурси, без `apply`.

**`scripts/aws.sh`:**

Профіль завжди `pdp`, власний kubeconfig `~/.kube/pdp-aws` (контексти інших кластерів не
чіпаються). Значення секретів ідуть у `kubectl` лише через stdin і файлові дескриптори, не
через аргументи. Версії чартів зафіксовані в скрипті; `helm-check.sh` перевіряє values
компонентів (`deploy/aws/*.yaml`) схемами цих чартів тих самих версій.

- [x] Чарт `deploy/helm/cluster-aws`: StorageClass `gp3` за замовчуванням (том зникає разом з
      PVC), `ClusterIssuer` `letsencrypt-staging` і `letsencrypt-prod` (DNS-01 у Route 53), один
      `Certificate` (ECDSA) на `pdp-media-pipeline.online` і `*.pdp-media-pipeline.online` у
      namespace `traefik` — `TLSStore` `default`, тож Ingress сервісів без секції `tls`.
      Видавець — `TLS_ISSUER`, за замовчуванням prod.
- [x] Релізи компонентів: metrics-server 3.14.0, AWS Load Balancer Controller 3.6.0 (`vpcId` і
      `clusterName` явно: подам IMDS недоступний), cert-manager v1.21.2, Traefik 42.0.0 (NLB
      `ip`-цілі, proxy protocol від `10.40.0.0/16`, `web` → `websecure` постійною
      переадресацією, `publishedService` для статусу Ingress), external-dns 1.23.0 (джерело
      `ingress`, `domainFilters`, `policy: sync`, власник TXT `pdp`), KEDA 2.21.0.
- [x] Сертифікат prod між сесіями: Let's Encrypt дає п'ять сертифікатів на ті самі імена за
      тиждень, а кожен `up` — новий кластер. `down` кладе ланцюжок у `/pdp/prod/tls-crt` (рівень
      `Intelligent-Tiering`: повний ланцюжок prod більший за 4 КБ стандартного параметра, перший
      `down` його не зберіг), ключ у `/pdp/prod/tls-key` (SecureString), `up` повертає
      Secret з анотаціями видавця, і cert-manager його не перевипускає.
- [x] Secret `postgres-app` (ключ `uri`), Secret `dub-provider` (ключ `openaiApiKey`, попередження,
      якщо ключ не внесено), обидва з SSM; ConfigMap `rds-ca` (бандл регіону) у namespace `pdp`.
- [x] `up`: профіль і акаунт (інакше підказка `aws sso login`); теги образів з
      `/pdp/prod/deployed-tag/*` до будь-яких витрат — без образів у ECR скрипт зупиняється;
      старт RDS; план базового шару з підтвердженням, `apply` шару `cluster`; компоненти,
      секрети, платформа, реліз `pdp`, користувач `smoke` (5b.3); очікування сертифіката. Після
      `apply` кластера — очікування, поки access policy адміністратора дійде до API (секунди).
- [x] `down`: кількість незавершених задач (усі, крім `succeeded` і `dead`) з RDS і
      підтвердження, якщо вони є; збереження сертифіката; видалення `pdp` і `platform`, PVC і
      очікування, поки зникнуть PV (EBS); очікування, поки external-dns прибере записи (перший
      `down` лишив A і AAAA апексу на видалений NLB, а без своїх TXT external-dns їх уже не
      чіпає. Другий лишив їх теж: TXT апексу без префікса — `a-pdp-media-pipeline.online`, поза
      зоною, і external-dns його мовчки пропускає (external-dns#4234); тепер
      `txtPrefix: edns-%{record_type}.` кладе TXT усередину зони, перевірка — наступним `up` і
      `down`); видалення Traefik — Service тримає finalizer, доки контролер не прибере NLB,
      target groups і security groups; `destroy` шару `cluster`; зупинка RDS; перевірка, що NLB,
      EBS з тегами кластера й записи на NLB не лишилися.
- [x] `status`: кластер, RDS (і коли зупинено — AWS стартує його через 7 днів), вузли й поди,
      адреси, вартість, залишки.
- [x] `grafana`: `kubectl port-forward` на `localhost:3000`; `seed` — як у `k8s.sh`.
- [x] Базовий шар: `database_enabled` за замовчуванням `true` — RDS створить перший `up` (план
      зараз: 2 ресурси, інстанс і параметр з URL).

**Перевірити:**

- `https://api.pdp-media-pipeline.online/health/ready`; сертифікат спершу від staging, потім prod;
- `https://app.pdp-media-pipeline.online`: реєстрація й вхід, завантаження картинки й відео, переклад
  відео з прогресом, перегляд із субтитрами, медіатека;
- `aws.sh grafana`: дашборди, трейси одного дубляжу, посилання на трейс з UI;
- gateway бачить справжній IP клієнта (`429` за IP для невідомого ключа);
- з `DUB_SYSTEM_QUOTA_SECONDS=60` другий дубляж отримує `429 DUB_SYSTEM_QUOTA_EXCEEDED`;
- `down` з незавершеною задачею питає підтвердження: черга NATS зникає з кластером, і
  автоматичної повторної відправки задач немає, тож така задача лишається у своєму статусі;
- після `down` у консолі немає NLB, EBS-томів і EC2, `terraform state list` шару `cluster` порожній.

**Коміти:** `feat(config): S3 credentials from the pod role` → `feat(metadata): system-wide dub
quota` → `feat(web): show the system dub limit` →
`feat(helm): service accounts and Pod Identity egress` → `feat(helm): AWS profile` →
`infra(terraform): EKS cluster layer` → `feat(scripts): aws.sh up, down and status`.

## Підетап 5b.3. Деплой з CI

Push образів іде перед першим `aws.sh up`: без образів у ECR `up` зупиняється, а збирати
x86-образи на Mac з ARM (`audio-separate` — 5.9 ГБ) довго. Перевірки 5b.2 на живому кластері —
після першого push.

- [x] `.github/workflows/deploy.yml`: `workflow_run` після успішного CI на `main` (лише `push`
      з цього ж репозиторію — PR з форку теж може мати гілку `main`; checkout `head_sha` того
      запуску) і `workflow_dispatch`; environment `aws`; `concurrency: deploy-aws` без
      скасування поточного.
  - OIDC → роль `pdp-deploy`; build і push у ECR матрицею з 8 образів (кеш CI з `main`,
    звільнення диска для `audio-separate` і `video-dub`, без provenance-індексу); образ, чий тег
    уже є в ECR, не збирається — і `audio-separate` з тегом за вмістом, і повторний запуск
    того самого коміту (теги незмінні);
  - теги пишуться в `/pdp/prod/deployed-tag/*` окремим job'ом, коли всі образи в ECR;
  - `scripts/aws.sh release`: якщо кластер не `ACTIVE` — зелений з повідомленням «кластер
    вимкнений», інакше `helm upgrade --install pdp` з `values-prod.yaml` і `values-aws.yaml`,
    `--rollback-on-failure` (Helm 4, колишній `--atomic`); міграції — той самий хук. Платформу
    й компоненти оновлює `aws.sh up`, не CI;
  - права в кластері: access policy EKS покриває лише вбудовані типи, тож access entry ролі
    має групу `pdp-deploy`, а `cluster-aws` дає їй `Role` на `ScaledObject` і `Middleware` у
    namespace `pdp`; `deny` у ролі доповнено ключем сертифіката `/pdp/prod/tls-key`;
  - [x] smoke-тест після релізу, якщо кластер `ACTIVE`.
  - [x] другий `up` завис на ~10 хв: `audio-separate` (2 CPU) стартував першим, і `video-dub`
        не вмістився на два вузли, а consumer'и, за якими KEDA масштабує обидва, створює лише
        перший старт `video-dub` — без них KEDA не зводить до нуля нічого. В AWS `audio-separate`
        при установці має 0 реплік (`autoscaling.initialReplicas`), KEDA піднімає його з першим
        дубляжем. Лише при установці: Helm 4 застосовує маніфест server-side і на кожному
        оновленні забирав би репліки в KEDA.
  - [x] з тієї ж причини перший дубляж стояв у `scheduled`: KEDA підняла обидва поди, а
        `video-dub` (запит 1 CPU) не вміщався — після `audio-separate` на вузлах лишається ~1.8
        CPU, але ніде цілого. В AWS запит `video-dub` — 500m, ліміт як і був, 2 CPU.
  - [x] після цього дубляж з нуля став `dead` (`exhausted`): `video-dub` стартує за секунду, а
        `audio-separate` на вузлі без образу тягне 2.3 ГБ ~45 с, і 5 спроб задачі (~25 с) на
        `fetch failed` скінчились раніше. Клієнт `audio-separate` тепер чекає на відмову в
        з'єднанні (`ECONNREFUSED`, за Service ще нема пода) так само, як на зайнятий под, — у
        межах свого таймауту 5 хв, не витрачаючи спроб задачі. Перевірено 20 жовтня: три
        дубляжі, перший з нуля, — `succeeded` з першої спроби (образ уже був на вузлі).
- [x] `scripts/smoke.sh <base-url>`: `GET /health/ready`, потім одна справжня задача `image.resize`:
      upload через presigned URL (`perf/k6/fixtures/source.png`), `POST /v1/jobs`, очікування
      `succeeded` (до 2 хв), завантаження одного результату з перевіркою розміру,
      `GET /v1/assets/{id}` — у файлі є ця задача. Ключ — секрет environment `aws`
      (`SMOKE_API_KEY`); користувача `smoke` створює `aws.sh up` один раз і друкує ключ, у RDS
      він переживає перестворення кластера. Вхід паролем smoke не перевіряє: це ще один секрет,
      а сесію покривають інтеграційні тести. Дубляж у smoke не входить: він платний і стартує
      з нуля. Падіння — workflow червоний. Перевірено проти compose-стека.
- [x] Налаштування GitHub (робите ви): environment `aws` з правилом «лише `main`», змінна
      `AWS_ROLE_ARN` (регіон — у workflow), секрет `SMOKE_API_KEY`.
- [x] Перевірити руками: змінити відповідь endpoint'а (наприклад, `version` у `/health/ready`),
      змерджити, побачити нову версію за доменом без ручних кроків; запуск з іншої гілки не
      отримує роль. Перевірено 20 жовтня: два мерджі в `main` викотились із зеленим smoke без
      ручних кроків; запуск з `feature/stage-5b.3-smoke` environment відхилив до видачі ролі
      (у CloudTrail жодного `AssumeRoleWithWebIdentity`).
- [x] README: розділ «Запуск в AWS» (передумови, SSO, `aws.sh up/down`, адреси, вартість) і
      «Етап 5b» у перевірці етапів.
- [x] План, прогрес і ADR — статус «готово» після перевірки деплою з CI.

**Коміти:** `feat(scripts): smoke test against a base URL` → `ci: deploy to AWS after CI on main`
→ `docs: running in AWS`.

## Ризики

- **Ліміти Let's Encrypt.** На той самий набір імен — не більше 5 сертифікатів на тиждень, а кожне
  перестворення кластера випускає нові. Під час налагодження — `letsencrypt-staging`,
  production — для перевірок і демо. Запасний варіант — ACM на NLB (безкоштовно, сертифікат
  живе в базовому шарі, CAA для `amazon.com` уже в зоні).
- **Забуті ресурси.** NLB і EBS, створені з кластера, Terraform не бачить. Якщо знищити кластер, не
  видаливши Service і PVC, вони лишаться й коштуватимуть гроші. `aws.sh down` видаляє їх першими й
  чекає; бюджетний алерт — страховка.
- **Ліміт дубляжу вичерпає хтось один.** Загальний ліміт захищає гроші, а не доступ: зареєстровані
  акаунти можуть з'їсти його за всіх. На демо ліміт піднімається значенням у `values-aws.yaml`.
- **Зміна nameservers** може йти до 48 год: TTL делегування в зоні `.online` задає реєстр, а
  новий домен GoDaddy ще й публікує не одразу. Тому робити першим.
- **RDS сам стартує через 7 днів** після зупинки. `aws.sh status` це показує; за бажанням —
  EventBridge Scheduler, що щоночі зупиняє інстанс.
- **Довгий цикл.** `apply` кластера ~15–20 хв, `destroy` ~10 хв: налагоджувати Helm-частину
  локально на k3d з `values-aws.yaml`, де це можливо.
- **Перший дубляж після простою** чекає старту `audio-separate` з нуля; перше витягування
  2.3 ГБ образу на вузол додає ~1 хв. SLO дубляжу (95% за 15 хв) це вміщає.
- **Публічний endpoint EKS API** відкритий для IP GitHub-раннерів; захищає IAM-автентифікація й
  мінімальна роль деплою.
- **Обсяг.** Три PR при 8–10 год/тиждень — щільно. Якщо не вкладається, smoke-тест з
  медіатекою переходить на початок Етапу 6.
