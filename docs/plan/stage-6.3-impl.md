# Підетап 6.3 — покриття і E2E: план реалізації

> **Для агентів:** виконувати задачу за задачею (superpowers:executing-plans або
> subagent-driven-development), кроки — чекбокси `- [ ]`.

**Мета:** CI падає, коли покриття бекенду чи Web UI опускається нижче порогу, а три головні флоу
користувача проходяться в справжньому браузері проти зібраних образів на кожен PR
([`stage-6.md`](stage-6.md)).

**Архітектура:** unit (`pnpm test:cov`) та інтеграційні (`pnpm test:int --coverage`) тести, як і
раніше, ідуть в окремих CI-job'ах і кладуть `coverage-final.json` в артефакти. Новий job
`coverage` зливає їх `scripts/coverage.mjs` разом із покриттям Web UI і тримає пороги: увесь
бекенд і чотири зони. E2E — Playwright у `e2e/` проти окремого compose-проєкту `pdp-e2e`, який
накладає `e2e/compose.yaml` на `docker-compose.yml`: лише потрібні сервіси, назовні — тільки `web`
і MinIO (браузер вантажить файл за presigned URL), усі провайдери дубляжу фейкові.

**Стек:** `istanbul-lib-coverage` (зливає за положенням у коді, тож різні tsconfig unit та
інтеграційних тестів не заважають), `@vitest/coverage-v8`, `@playwright/test` з Chromium,
`@axe-core/playwright`.

## Стартові цифри (21 жовтня 2026)

| Що                         | Рядки         | Гілки         |
| -------------------------- | ------------- | ------------- |
| Unit, бекенд і libs        | 55.1%         | 43.9%         |
| Інтеграційні, apps         | 86.1%         | 68.3%         |
| Зведене, бекенд            | 88.9%         | 78.4%         |
| Web UI (Vitest)            | 97.0%         | 89.5%         |
| Зони: вхід / сесії         | 97.9% / 98.6% | 81.3% / 90.5% |
| Зони: медіатека / підгонка | 98.7% / 100%  | 89.1% / 98.0% |

Пороги гілок за ними: бекенд — 78%, Web UI — 89%. Зони вже вище 80%, тож задача 2 зводиться до
перевірки звіту, без нових тестів.

## Зони

Зона — це набір файлів бекенду і Web UI; поріг — 80% рядків на зону сумарно:

| Зона             | Файли                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Вхід             | gateway `auth.controller`, `auth.guard`, `auth.dto`; Metadata `auth/`; Web `features/auth`, `pages/login`, `pages/register` |
| Сесії            | gateway `session.service`, `session-cookie`, `user`; Web `RequireAuth`                                                      |
| Медіатека        | gateway і Metadata `assets/`; Web `features/assets`, `pages/library`, `pages/asset`                                         |
| Підгонка дубляжу | `video-worker/src/dub/fit/`                                                                                                 |

## Рішення

- **Поріг гілок — на досягнутому рівні**, округленому вниз: бекенд і Web UI. Гілки можуть лише
  рости; підняти поріг — окремим рядком у тому ж PR, що додає тести.
- **Зона без жодного файлу — помилка**: перенесений файл не має тихо випасти з перевірки.
- **E2E без кореневого `.env`:** compose запускається з `--env-file e2e/.env`, бо в кореневому
  можуть бути `DUB_PROVIDERS=openai` і ключ OpenAI. Override явно ставить `DUB_PROVIDERS`,
  `DUB_TTS` і `DUB_AUDIO_SEPARATE` у `fake` і порожній `OPENAI_API_KEY`.
- **Образи — з кешу job'а `docker`:** job `e2e` іде після нього і збирає ті самі Dockerfile з тим
  самим `cache-from: type=gha`, тож шари беруться з кешу, а не передаються артефактом у гігабайти.
- **Медіа для тестів генерується** в global setup Playwright через `ffmpeg-static`, як в
  інтеграційних тестах: у репозиторії немає бінарних фікстур.
- **Кожен тест — свій користувач** з унікальним email: тести не залежать один від одного й від
  порядку; ліміти входу в `e2e/.env` підняті, щоб реєстрації з однієї IP не впиралися в них.

## Задачі

### 1. Зведене покриття

- [x] Звіт `json` у `jest.config.js` і `jest.int.config.js`; `scripts/coverage.mjs` з тестами
      (`scripts/coverage.test.mjs`), devDependencies `istanbul-lib-*`.
- [x] Web UI: `@vitest/coverage-v8`, пороги у `vite.config.ts`, скрипт `test:web:cov`.
- [x] Пороги за фактичними цифрами; CI: job `test` запускає `test:web:cov`, артефакти з
      `coverage-final.json`, job `coverage` після `test` і `integration`.
- [x] Коміт `ci: merged coverage thresholds`.

### 2. Зони до 80%

- [x] Звіт за зонами; тести там, де зона нижче 80%.
- [x] Окремого коміту немає: тестів не бракувало.

### 3. E2E

- [ ] `e2e/compose.yaml`, `e2e/.env`, `scripts/e2e.sh up|test|down`, `e2e/playwright.config.ts`,
      global setup з медіа.
- [ ] Флоу: реєстрація → вихід → вхід; завантаження фото → медіатека → видалення; завантаження
      відео з перекладом → сторінка дубляжу з кроками прогресу → результат.
- [ ] axe на екранах входу, медіатеки, файлу й перекладу: без `serious` і `critical`.
- [ ] Коміт `test(e2e): three browser flows with axe`.

### 4. CI

- [ ] Job `e2e` після `docker`: збірка образів з кешу, `scripts/e2e.sh`, звіт Playwright і логи
      compose в артефакт при падінні.
- [ ] Відмітити 6.3 у `stage-6.md`. Коміт `ci: e2e job`.
