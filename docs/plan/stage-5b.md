# Етап 5b. AWS, домен і перший деплой з CI

- Тижні 24–25: 22 березня – 4 квітня 2027 (після етапів 5c і 5d, [план](stages-5c-5d.md); у PDF —
  тижні 16–17)
- Статус: план. Етап розбито на три PR:
  - **5b.1 «Terraform: базовий шар і домен»**, гілка `feature/stage-5b.1-terraform-base`;
  - **5b.2 «EKS і застосунок в AWS»**, гілка `feature/stage-5b.2-eks`;
  - **5b.3 «Деплой з CI»**, гілка `feature/stage-5b.3-deploy-ci`.

## Результат і критерій

**Результат:** система працює в AWS, API відкривається за власним доменом через HTTPS, а merge у
`main` автоматично деплоїть нову версію. Наступні етапи (chaos, canary, перформанс) йдуть уже на
цьому кластері.

**Готово, коли:**

- `https://api.<домен>` відповідає з валідним сертифікатом;
- інфраструктура піднімається з нуля через `terraform apply`;
- merge у `main` без ручних дій доходить до AWS і проходить smoke-тест. Canary і rollback — Етап 7.

## Що вже є

- Helm: library-чарт `pdp-lib`, umbrella `pdp` з `values-dev.yaml` і `values-prod.yaml`
  (Ingress для `api.` і `app.`, `TRUST_PROXY_HOPS`, мінімум 2 репліки), чарт `platform`
  (NATS, Redis, MinIO, CloudNativePG, observability). Міграції — Job з хуком
  `pre-install,pre-upgrade`.
- Автоскейл KEDA за лагом консюмерів, HPA gateway, PDB, anti-affinity, graceful shutdown (ADR-012).
- CI: `verify`, `test`, `integration`, `audit`, `helm`, `alert-rules`, `docker` (збирає образи
  без push, Trivy у режимі звіту).
- `scripts/k8s.sh` для k3d, `scripts/e2e-smoke.sh` для compose і k3d.
- AWS-акаунт з MFA і бюджетним алертом (Етап 0). Домен куплено в іншого реєстратора.

## Що треба змінити в наявному коді

- **S3 без статичних ключів.** `s3EnvSchema` вимагає `S3_ENDPOINT`, `S3_ACCESS_KEY` і
  `S3_SECRET_KEY`. В AWS ключів немає: SDK бере облікові дані з ролі пода. Ключі й endpoint
  стають необовʼязковими, `S3_FORCE_PATH_STYLE=false`; presign — на регіональний endpoint S3.
- **TLS до RDS.** RDS PostgreSQL 15+ вимагає TLS (`rds.force_ssl=1`). `DATABASE_URL` з
  `sslmode=verify-full` і CA-бандлом RDS (публічний файл, монтується з ConfigMap); перевірити, що
  `pg` і `drizzle-kit migrate` його приймають.
- **Платформа без Postgres і MinIO.** У `platform` — `postgres.enabled` і `minio.enabled`; в AWS
  обидва вимкнені, PVC для NATS і observability — на `gp3` (EBS CSI).
- **Grafana за логіном.** Локально Grafana анонімна; на `grafana.<домен>` — вхід адміністратора
  з паролем із Secret.
- **Розміри під вузли.** `values-prod.yaml` просить 2 CPU на под транскодингу і по 2 репліки
  кожного класу: на двох вузлах це не вміститься. `values-aws.yaml` зменшує мінімуми й requests.

## Що додають етапи 5c і 5d

Етап 5b тепер іде після входу, медіатеки й перекладу відео, тому інфраструктура проєктується
одразу під них:

- **Redis із сесіями.** Досі Redis тримав лише лічильники rate limit, і їх втрата нічого не
  ламала. Тепер у ньому сесії: падіння або перезапуск без даних розлогінює всіх. Потрібні
  персистентність (AOF) і PVC на `gp3`; ElastiCache в ADR-017 порівнюється вже з цими вимогами.
- **S3.** Оригінали зберігаються навмисно (медіатека). Завантаження, з яких не створили задачу,
  прибирає janitor Metadata, а не lifecycle-правило (ADR-014); об'єкти видаляє воркер через роль
  пода (`s3:ListBucket`, `s3:DeleteObject`).
- **Ключ провайдера дубляжу.** Не в репозиторії й не в values: SSM SecureString у Terraform, шар
  `cluster` створює з нього Secret у namespace `pdp`, як і `postgres-app`.
- **`video-dub`.** Ще один Deployment воркерів: requests і максимум реплік входять у розрахунок
  двох вузлів; egress лише до API провайдера через NetworkPolicy (у `vpc-cni` увімкнути
  network policy).
- **Вхід за доменом.** Cookie сесії з `Secure` на `app.<домен>`, перевірка `Origin` з цим хостом.

## Прийняті рішення

| Питання        | Рішення                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Кластер        | EKS, managed node group: 2 × `m7i.xlarge` (4 vCPU, 16 ГБ), on-demand. Обґрунтування й вартість — ADR-017 (у PDF — ADR-010). k3s на EC2 і EKS Auto Mode — в альтернативах                                                    |
| Режим роботи   | Кластер піднімається під роботу й демо і знищується; постійний лише дешевий базовий шар. RDS між сесіями зупиняється                                                                                                        |
| Регіон         | `eu-central-1`                                                                                                                                                                                                              |
| Дані           | RDS PostgreSQL (`db.t4g.micro`, 20 ГБ gp3, приватні підмережі), S3 замість MinIO. Redis і NATS JetStream — у кластері, як локально. ElastiCache — в альтернативах ADR                                                       |
| Мережа         | VPC з публічними й приватними підмережами в 2 AZ, **без NAT Gateway** (~$35/міс): вузли в публічних підмережах з security group, RDS — у приватних. Gateway endpoint для S3 (безкоштовний)                                  |
| Ролі для подів | EKS Pod Identity: асоціації переживають перестворення кластера без зміни trust policy. IRSA — в альтернативах                                                                                                               |
| Ingress        | Traefik (той самий, що в k3d) за NLB, який створює AWS Load Balancer Controller. ingress-nginx не беремо: проєкт знято з підтримки                                                                                          |
| TLS і DNS      | cert-manager з Let's Encrypt (DNS-01 через Route 53), external-dns створює записи з Ingress. Хости: `api.`, `app.`, `grafana.`                                                                                              |
| Домен          | Hosted zone у Route 53 (базовий шар), NS делегуються в реєстратора вручну один раз                                                                                                                                          |
| Terraform      | `deploy/terraform`: `bootstrap` (S3-бакет для state, локальний state), `base` (постійний), `cluster` (на вимогу). State у S3 з нативним блокуванням (`use_lockfile`), модулі `terraform-aws-modules` з фіксованими версіями |
| Образи         | ECR, репозиторій на сервіс, тег — SHA коміту, lifecycle: останні 20 образів                                                                                                                                                 |
| Секрети        | Пароль RDS — `random_password` у Terraform → SSM SecureString; шар `cluster` створює Secret `postgres-app` (ключ `uri`) з тим самим іменем, що дає CloudNativePG локально                                                   |
| CI → AWS       | GitHub OIDC, роль лише для `repo:VitaliiProts/pdp-media-pipeline` на `main` і environment `aws`: push в ECR, `eks:DescribeCluster`, access entry з правами лише на namespace `pdp`                                          |
| Параметри      | Terraform пише виходи (домен, бакет, ARN, endpoint RDS) в SSM Parameter Store `/pdp/prod/*`; `scripts/aws.sh` і CI читають звідти, у репозиторії нічого не копіюється                                                       |

## Вартість (оцінка, уточнюється в ADR-017 через AWS Pricing Calculator)

| Що                                          | Коли кластер працює | Коли вимкнений       |
| ------------------------------------------- | ------------------- | -------------------- |
| EKS control plane                           | ~$0.10 / год        | —                    |
| 2 × `m7i.xlarge`, EBS вузлів, публічні IPv4 | ~$0.50 / год        | —                    |
| NLB                                         | ~$0.03 / год        | —                    |
| RDS `db.t4g.micro`                          | ~$0.02 / год        | лише диск, ~$3 / міс |
| Route 53 zone, ECR, S3, SSM, state          | —                   | ~$1–2 / міс          |
| **Разом**                                   | **~$0.65 / год**    | **~$4–5 / міс**      |

30–40 годин роботи на місяць — близько $25–30. Бюджетний алерт піднімається до $30 з
повідомленнями на 50%, 80% і 100% прогнозу.

## Підетап 5b.1. Terraform: базовий шар і домен

- [ ] Локальний доступ до AWS через IAM Identity Center (`aws configure sso`), без статичних ключів.
- [ ] `deploy/terraform/bootstrap`: S3-бакет для state (versioning, шифрування, Block Public Access).
- [ ] `deploy/terraform/base`:
  - Route 53 hosted zone; NS-записи вручну в реєстратора, перевірка `dig NS <домен>`;
  - VPC: 2 AZ, публічні й приватні підмережі, без NAT, S3 gateway endpoint;
  - RDS PostgreSQL: приватні підмережі, SG лише з SG вузлів, бекапи 1 день, `deletion_protection`;
  - S3-бакет медіа: Block Public Access, CORS для `https://app.<домен>`, шифрування (без
    lifecycle-правила для `uploads/`: їх прибирає janitor, ADR-014);
  - SSM SecureString для ключа провайдера дубляжу (значення вносите ви, не Terraform);
  - ECR-репозиторії для 7 образів з lifecycle policy;
  - GitHub OIDC provider і роль деплою;
  - AWS Budgets $30 з алертами;
  - параметри в SSM `/pdp/prod/*`.
- [ ] ADR-017 «Де запускати кластер»: EKS проти k3s на EC2 і EKS Auto Mode, Pod Identity проти
      IRSA, Redis у кластері проти ElastiCache (з урахуванням сесій), NAT проти публічних
      підмереж; вартість на місяць для «постійно» і «на вимогу».
- [ ] Таблиця відповідності ADR номерам PDF: 010 → 017.

## Підетап 5b.2. EKS і застосунок в AWS

- [ ] `deploy/terraform/cluster`:
  - EKS (актуальна версія зі standard support), node group 2 × `m7i.xlarge`, публічний endpoint
    API з автентифікацією IAM;
  - addons: `vpc-cni`, `coredns`, `kube-proxy`, `aws-ebs-csi-driver`, `eks-pod-identity-agent`;
    StorageClass `gp3` за замовчуванням;
  - access entries: адміністратор (ваша SSO-роль) і роль деплою (namespace `pdp`);
  - Pod Identity: воркери, video-*, gateway → S3; external-dns і cert-manager → Route 53;
    LB Controller, EBS CSI;
  - Helm-релізи кластерних компонентів: AWS Load Balancer Controller, Traefik (Service на NLB,
    proxy protocol), cert-manager з ClusterIssuer `letsencrypt-staging` і `letsencrypt-prod`,
    external-dns, KEDA, metrics-server;
  - Secret `postgres-app`, Secret з ключем провайдера дубляжу (з SSM) і ConfigMap з CA-бандлом
    RDS у namespace `pdp`;
  - network policy у `vpc-cni` для egress-правил `video-dub`.
- [ ] Код: S3 без статичних ключів і з необовʼязковим endpoint; TLS до RDS; тести на обидва
      режими конфігу.
- [ ] Helm:
  - `platform/values-aws.yaml`: без Postgres і MinIO, PVC на `gp3`, Redis з AOF і PVC (сесії),
    Grafana з логіном та Ingress `grafana.<домен>`;
  - `pdp/values-aws.yaml` поверх `values-prod.yaml`: образи з ECR, хости з доменом, анотації
    cert-manager, S3 через роль, менші мінімуми реплік і requests під два вузли (разом з
    `video-dub`), `TRUST_PROXY_HOPS=1`;
  - `helm-check.sh` рендерить і AWS-профіль.
- [ ] `scripts/aws.sh`:
  - `up`: `terraform apply` для `base` і `cluster`, старт RDS, платформа, реліз `pdp` з останнім
    тегом `main` з ECR;
  - `down`: видалити релізи (NLB і EBS зникають разом із Service і PVC), дочекатися, поки
    LB видалиться, `terraform destroy` шару `cluster`, зупинити RDS;
  - `status`: що зараз працює і скільки коштує година.
- [ ] Перевірити: `https://api.<домен>/health/ready`, `https://app.<домен>` (реєстрація і вхід,
      завантаження картинки й відео, переклад відео, медіатека), `https://grafana.<домен>` (дашборди, трейси), сертифікат Let's Encrypt, gateway бачить
      справжній IP клієнта (`429` за IP для невідомого ключа).

## Підетап 5b.3. Деплой з CI

- [ ] `.github/workflows/deploy.yml`: після успішного CI на `main` (`workflow_run`) і вручну
      (`workflow_dispatch`); environment `aws`.
  - OIDC → роль деплою; build і push 7 образів у ECR з тегом SHA (кеш з CI);
  - якщо кластер не існує — job зелений з повідомленням «кластер вимкнений, образи в ECR», а
    `aws.sh up` потім розгорне цей тег;
  - `helm upgrade --install pdp` з `values-prod.yaml` і `values-aws.yaml`, `--atomic --wait`;
    міграції — той самий хук;
  - smoke-тест.
- [ ] `scripts/smoke.sh <base-url>`: `GET /health/ready`, потім одна справжня задача `image.resize`:
      upload через presigned URL, `POST /v1/jobs`, очікування `succeeded` (до 2 хв), `GET` одного
      результату. Ключ — секрет environment `aws` (`SMOKE_API_KEY`); користувача створює
      `aws.sh` один раз, у RDS він переживає перестворення кластера. Окремо — вхід тестовим
      користувачем і `GET /v1/assets`. Падіння — workflow червоний.
- [ ] Налаштування GitHub (робите ви): environment `aws`, змінні `AWS_REGION` і `AWS_ROLE_ARN`,
      секрет `SMOKE_API_KEY`.
- [ ] Перевірити руками: змінити відповідь endpoint'а (наприклад, `version` у `/health/ready`),
      змерджити, побачити нову версію за доменом без ручних кроків.
- [ ] README: розділ «Запуск в AWS» (передумови, `aws.sh up/down`, адреси, вартість) і «Етап 5b»
      у перевірці етапів; план і ADR — статус «готово».

## Ризики

- **Ліміти Let's Encrypt.** На той самий набір імен — не більше 5 сертифікатів на тиждень, а кожне
  перестворення кластера випускає нові. Під час налагодження — `letsencrypt-staging`, production —
  для перевірок і демо. Запасний варіант — ACM на NLB (безкоштовно, сертифікат живе в базовому шарі).
- **Забуті ресурси.** NLB і EBS, створені з кластера, Terraform не бачить. Якщо знищити кластер, не
  видаливши Service і PVC, вони лишаться й коштуватимуть гроші. `aws.sh down` видаляє їх першими й
  чекає; бюджетний алерт — страховка.
- **Делегування NS** може йти до 48 год: зробити заздалегідь, ще під час етапів 5c і 5d (hosted
  zone коштує $0.50 на місяць).
- **RDS сам стартує через 7 днів** після зупинки. `aws.sh status` це показує; за бажанням —
  EventBridge Scheduler, що щоночі зупиняє інстанс.
- **Довгий цикл.** `apply` кластера ~15–20 хв, `destroy` ~10 хв: налагоджувати Helm-частину
  локально на k3d з `values-aws.yaml`, де це можливо.
- **Публічний endpoint EKS API** відкритий для IP GitHub-раннерів; захищає IAM-автентифікація й
  мінімальна роль деплою.
- **Обсяг.** Три PR за два тижні при 8–10 год/тиждень — щільно. Якщо не вкладається, smoke-тест з
  відео й Grafana за доменом переходять на початок Етапу 6.
