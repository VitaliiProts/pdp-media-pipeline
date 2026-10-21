# Підетап 6.2 — Pact: план реалізації

> **Для агентів:** виконувати задачу за задачею (superpowers:executing-plans або
> subagent-driven-development), кроки — чекбокси `- [ ]`.

**Мета:** зміна відповіді Metadata, повідомлення NATS чи того, що з них читає споживач, ламає CI,
доки обидві сторони не узгоджені, — без брокера, бо обидві сторони в одному PR
([`stage-6.md`](stage-6.md)).

**Архітектура:** споживачі пишуть контракти тестами в `test/pact/consumers/` (`pnpm test:pact`,
без Docker) у `pacts/`; файли комітяться. Провайдери перевіряють закомічені файли в
`test/pact/*.int-spec.ts`, тобто в CI-job `integration`: Metadata — справжній застосунок на
Testcontainers, scheduler — без інфраструктури. Job `test` перегенеровує контракти й падає, якщо
вони розходяться із закоміченими.

**Стек:** `@pact-foundation/pact` 17 (специфікація V4, ядро на Rust через FFI), Jest і ts-jest, як
в інтеграційних тестах.

## Учасники

Імена — за застосунками, бо контракт належить тому, хто розгортається, а не бібліотеці:

| Споживач       | Провайдер   | Що                                                                                       |
| -------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `api-gateway`  | `metadata`  | HTTP: задачі, assets, вебхуки, реєстрація і вхід, користувач, квота дубляжу, ключі       |
| `scheduler`    | `metadata`  | HTTP: перехід у `scheduled`; повідомлення `job.created`                                  |
| `worker`       | `metadata`  | HTTP: переходи `JobRunner`, ендпоінт вебхука, задачі asset; повідомлення `asset.deleted` |
| `video-worker` | `metadata`  | HTTP: переходи `JobRunner`, прогрес                                                      |
| `worker`       | `scheduler` | Повідомлення dispatch: `image.resize`, `webhook.deliver`                                 |
| `video-worker` | `scheduler` | Повідомлення dispatch: `video.frames`, `video.transcode`, `video.dub`                    |

`asset.deleted` у `stage-6.md` не згаданий, але це так само межа між сервісами: Metadata пише
подію, `worker` за нею чистить сховище.

## Рішення

- **Споживач — справжній код.** HTTP-взаємодії виконує `MetadataClient`, тож відповідь Pact
  проходить ту саму zod-схему, що в проді. Повідомлення проходять справжні обробники:
  `JobCreatedHandler`, `AssetPurgeHandler`, `JobRunner` із вхідною схемою процесора.
- **Стан провайдера — через API самої Metadata.** State handlers створюють користувача, assets,
  задачі й переходи внутрішнім API і повертають id; споживач підставляє їх через
  `fromProviderState`. Без сирого SQL, тож контракт не прив'язаний до схеми бази. Перед кожною
  взаємодією таблиці очищаються.
- **Повідомлення Metadata — з outbox.** Провайдер створює задачу чи видаляє asset через API і
  повертає конверт, який реально ліг у `outbox`. Повідомлення scheduler — те, що
  `JobCreatedHandler` публікує на `job.created` з валідним входом цього типу.
- **Відповідність — за типом, точно — лише те, від чого залежить поведінка споживача:** статус,
  `applied`, `replayed`, коди помилок, тип задачі й клас.
- **Свіжість контрактів.** `pnpm test:pact` спершу видаляє `pacts/`: Pact дописує в наявний файл,
  і прибрана взаємодія лишилась би в контракті. Job `test` після нього робить
  `git diff --exit-code pacts/`.
- `pacts/` — у `.prettierignore`: файли пише Pact. `PACT_DO_NOT_TRACK=true` у конфігах Jest.

## Задачі

### 1. Каркас і gateway → Metadata

- [x] `jest.pact.config.js`, скрипт `test:pact`, `pacts/` у `.prettierignore`.
- [x] `test/pact/support/`: зразки DTO з матчерами (`job`, `asset`, `user`, …), спільні для
      споживачів.
- [x] `test/pact/consumers/api-gateway.pact-spec.ts`: кожен метод `MetadataClient`, який викликає
      gateway, плюс помилки, від яких залежить його поведінка: `JOB_NOT_FOUND`,
      `INVALID_CREDENTIALS` (вхід повертає `null`), `EMAIL_TAKEN`, `API_KEY_NOT_FOUND`
      (ключ не знайдено → `null`), повтор з тим самим `Idempotency-Key` (`replayed: true`).
- [x] `test/pact/metadata.int-spec.ts`: Metadata на Testcontainers, state handlers, очищення
      таблиць перед взаємодією.
- [x] Коміт `test(pact): gateway contract with Metadata`.

### 2. Воркери і scheduler → Metadata (HTTP)

- [x] Спільні взаємодії `JobRunner` (`running`, `succeeded`, `scheduled` на повтор, `dead`,
      `JOB_TERMINAL`, `STALE_ATTEMPT`) — функцією, яку викликають обидва воркери.
      `STALE_ATTEMPT` — на запізнілий `dead` замінної спроби: успіх старшої спроби Metadata
      приймає (перший успіх виграє), а її повторний `scheduled` — дублікат без змін.
- [x] `worker`: ендпоінт вебхука з секретом і `WEBHOOK_NOT_FOUND`, задачі asset для очищення.
- [x] `video-worker`: прогрес із кроком.
- [x] `scheduler`: `scheduled` з класом.
- [x] Коміт `test(pact): worker and scheduler contracts with Metadata`.

### 3. Повідомлення

- [x] `scheduler` ← `job.created`; `worker` ← `asset.deleted`: провайдер Metadata з outbox.
- [x] `worker`, `video-worker` ← dispatch за типами: провайдер scheduler
      (`test/pact/scheduler.int-spec.ts`, без інфраструктури).
- [x] Коміт `test(pact): NATS message contracts`.

### 4. CI і перевірка руками

- [ ] Job `test`: `pnpm test:pact` і `git diff --exit-code pacts/`. Перевірка провайдерів іде в
      `integration` разом з `test:int`.
- [ ] Перейменувати поле у відповіді Metadata (`toJobDto`) — перевірка провайдера червона;
      додати обов'язкове поле в `JobDto` лише на боці споживача — червоний тест споживача.
      Повернути як було.
- [ ] Відмітити 6.2 у `stage-6.md`. Коміт `ci: verify the pacts`.
