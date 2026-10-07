# ADR-004. Структура монорепо

- Статус: Прийнято
- Дата: 2026-10-08

## Контекст

Чотири сервіси (API Gateway, Metadata, Scheduler, Worker) ділять контракти подій, конфігурацію,
логування і health-check'и. Контракти мають змінюватись атомарно з усіма споживачами. Одна людина
веде проєкт, тому накладні витрати на інфраструктуру репозиторіїв мають бути мінімальними.
Пізніше CI має збирати лише змінені сервіси (Етап 7), а Pact перевіряти контракти між ними (Етап 6).

## Рішення

Монорепо на **pnpm workspaces** без Nx і Turborepo:

```
apps/
  api-gateway/   metadata/   scheduler/   worker/      # NestJS, кожен з Dockerfile
libs/
  contracts/     # події й енуми на zod, з версією (job.created v1, job.status_changed v1)
  config/        # zod-схеми env + @nestjs/config з fail-fast валідацією
  observability/ # Pino-логер, /health/live і /health/ready (terminus); далі OTel
  messaging/     # підключення до NATS і JetStream; далі publish/consume
deploy/helm/     # по чарту на сервіс
docs/adr/  docs/spikes/
perf/k6/
spikes/          # одноразовий код спайків, поза workspace
```

Правила:

- `apps/*` не імпортують одне одного і не лізуть у `libs/*/src` відносними шляхами: лише
  через `@pdp/<lib>`. Перевіряє dependency-cruiser (`pnpm depcruise`) у CI.
- `libs/*` не імпортують з `apps/*`.
- Збірка через `tsc` у CommonJS, `libs` експортують `dist`. Порядок збірки топологічний
  (`pnpm -r build`). `typecheck` спершу збирає libs.
- Спільні `tsconfig.base.json`, ESLint (flat config, typescript-eslint з type-checking),
  Prettier; husky + lint-staged на pre-commit.
- Docker-образ сервісу збирається з кореня репозиторію: `pnpm fetch` -> `install --offline` ->
  build -> `pnpm deploy --prod` у runtime-стейдж `node:22-alpine` під користувачем `node`.

`libs/messaging` не було в початковому плані: підключення до NATS однакове для трьох сервісів
(gateway, scheduler, worker), і дублювати його з першого дня немає сенсу.

## Альтернативи

- **Polyrepo**: незалежні релізи, але контракти потрібно публікувати як пакет і синхронізувати
  версії між чотирма репозиторіями. Для одного розробника це надлишково.
- **Nx**: генератори, граф проєктів, affected-команди, кешування. Мінус: власні абстракції над
  NestJS-збіркою і конфіг, який треба вивчати окремо; affected-збірку можна отримати через
  `pnpm --filter "...[origin/main]"`.
- **Turborepo**: кешування задач поверх pnpm. Може знадобитись на Етапі 7, якщо CI стане
  повільним; додається без зміни структури.
- **TypeScript project references або `paths` замість збірки libs**: менше кроків локально, але
  `paths` не працює в рантаймі Node без додаткових лоадерів і ускладнює Docker-збірку.

## Наслідки

- Позитивні: зміна контракту і всіх споживачів в одному PR; одна версія TypeScript, ESLint і
  NestJS; dependency-cruiser тримає межі між сервісами; образи містять лише prod-залежності свого
  сервісу.
- Негативні: перед typecheck застосунків треба зібрати libs; Docker-контекст включає весь
  репозиторій (обмежено `.dockerignore`); поки CI збирає все, вибіркова збірка з'явиться на Етапі 7.
- Ризики: спокуса покласти бізнес-логіку в libs. Правило: у libs лише контракти й інфраструктурний
  код, доменна логіка живе в сервісі, якому належить.
