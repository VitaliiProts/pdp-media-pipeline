# Етап 5c.4 — екрани входу, медіатеки й налаштувань: план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вхід і реєстрація email + паролем замість API-ключа, медіатека з фільтрами й нескінченною прокруткою, сторінка файлу з плеєром і завантаженням версій, налаштування з API-ключами.

**Architecture:** бекенд отримує фільтри `status`/`q` у `GET /v1/assets`, `downloadUrl` для оригіналу й версій і `seed-user --email --password`. Веб замінює фічі `api-key` і `session` на `auth` (cookie-сесія), додає фічі `assets`, `api-keys`, `language`, сторінки `library`, `asset`, `settings`, `register`. Дані медіатеки — RTK Query `infiniteQuery`; живі статуси — опитування раз на 3 с, поки є активні задачі.

**Tech Stack:** NestJS + drizzle (Metadata), zod-контракти, React 19, react-router 8 (data mode), RTK Query 2.13, i18next, CSS Modules, Vitest + Testing Library + MSW, інтеграційні тести на testcontainers.

**Специфікація:** [`docs/superpowers/specs/2026-10-15-stage-5c4-screens-design.md`](../specs/2026-10-15-stage-5c4-screens-design.md).

## Глобальні обмеження

Діють для кожної задачі; рев'юер перевіряє їх так само, як вимоги задачі.

- **TypeScript:** жодних `any`, `as` (крім `as const`), `!`, default-експортів. Звуження — через type guard.
- **Шари вебу:** `app → pages → features → shared`. Фіча не імпортує іншу фічу (depcruise `web-no-cross-feature`). Сторінки й `app` беруть фічу лише через її `index.ts`. Сторінка не імпортує іншу сторінку.
- **Тексти:** кожен видимий рядок — через `t()`, ключі в `en` і `uk` однакові (тест `app/i18n.test.ts`, який додає задача 5). Українські множини — `_one/_few/_many/_other`.
- **Примітиви** приймають нативні пропси свого кореня; атрибути, які компонент ставить сам, типізовано `?: never`.
- **Рух:** будь-яка анімація має `@media (prefers-reduced-motion: reduce) { animation: none; }`, тривалості — з токенів `--motion-*`.
- **Хуки:** правила eslint react-hooks 7 — жодного `setState` у тілі ефекту чи під час рендеру (крім патерну «підлаштувати стан під проп» через порівняння з попереднім значенням), жодного `Date.now()` під час рендеру.
- **Коментарі** — лише про обмеження, яких код не показує.
- **Коміти:** `feat(stage-5c.4): …`, `docs(stage-5c.4): …`, `fix(stage-5c.4): …` (для правок за рев'ю), трейлер `Co-authored-by: Cursor <cursoragent@cursor.com>`. Хук lint-staged запускає eslint і prettier. **Не пушити** — користувач пушить сам.
- **Перевірки** (з кореня репозиторію): `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`, `pnpm test:web` (Vitest), `pnpm test` (jest, юніти бекенду; один файл — `pnpm test -- <шлях>`), `pnpm test:int` (jest + testcontainers, потрібен Docker; один файл — `pnpm test:int -- test/<файл>`). Окремий тест вебу: `cd apps/web && pnpm vitest run <шлях>`.
- **Стабільність тестів:** жодних тестів, що спираються на таймінг мережі (`delay(150)` проти кліку). Якщо потрібен порядок подій — «ворота» на промісі, які тест відкриває сам. Перед комітом задачі з новими UI-тестами — прогін під навантаженням: `for i in 1 2 3 4; do (cd apps/web && CI=true pnpm vitest run <файл> >/tmp/run-$i.log 2>&1; echo "run $i: $?") & done; wait`.

## Мапа файлів

**Бекенд**

| Файл                                                               | Що змінюється                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `libs/contracts/src/assets.ts` (+ `assets.spec.ts`)                | `ASSET_STATUSES`, `status` і `q` у `ListAssetsQuery`              |
| `apps/metadata/src/assets/assets.service.ts`                       | фільтри за статусом останньої задачі й за назвою                  |
| `test/assets.int-spec.ts`                                          | фільтри, `downloadUrl`                                            |
| `libs/metadata-client/src/metadata-client.ts`                      | передає `status`, `q`                                             |
| `apps/api-gateway/src/assets/assets.dto.ts`                        | `status`, `q`, `originalDownloadUrl`, DTO версій із `downloadUrl` |
| `apps/api-gateway/src/storage/storage.service.ts`                  | `presignGet(key, ttl, { downloadName })`                          |
| `apps/api-gateway/src/jobs/job-presenter.ts` (+ spec)              | `toResponse(job, { downloadBase })`, імена файлів версій          |
| `apps/api-gateway/src/assets/assets.controller.ts`                 | `originalDownloadUrl`, задачі з `downloadUrl`                     |
| `apps/metadata/src/seed-user.ts` (+ spec), `test/auth.int-spec.ts` | `--email`, `--password`, опції об'єктом                           |
| `scripts/perf.sh`, `scripts/autoscale-demo.sh`                     | виклик `seedUser(…, { apiKey })`                                  |

**Веб** (`apps/web/src`)

| Файл                                                                                            | Що змінюється                                                                      |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `shared/api/http.ts` (+ test)                                                                   | `AppError.code`, `appErrorOf`, без API-ключа, `onUnauthorized(url)`                |
| `shared/api/base-api.ts`                                                                        | теги `Asset`, `ApiKey`                                                             |
| `shared/lib/use-countdown.ts` (+ test)                                                          | зворотний відлік для 429                                                           |
| `shared/lib/format-duration.ts` (+ test)                                                        | `m:ss` / `h:mm:ss`                                                                 |
| `features/auth/**`                                                                              | новий: API, `signedOut`, валідація, `LoginForm`, `RegisterForm`                    |
| `features/api-key/**`, `features/session/**`, `locales/*/apiKey.json`                           | видаляються                                                                        |
| `features/assets/**`                                                                            | новий: API медіатеки й файлу, `useLiveAssets`, `useLiveAsset`, `DeleteAssetButton` |
| `features/api-keys/**`                                                                          | новий: API ключів, список, створення, показ-один-раз, відкликання                  |
| `features/language/**`                                                                          | `LanguageSwitch`, перенесений з `app/layouts`                                      |
| `features/upload/**`                                                                            | `name` у запиті, `kind` у `Upload`, `quotaExceeded`, інвалідація `Asset`           |
| `app/store.ts` (+ test), `app/router.tsx`, `app/layouts/*`                                      | `signedOut`, без ключа, перехід у медіатеку, правило тостів                        |
| `pages/login`, `pages/register`, `pages/library`, `pages/asset`, `pages/settings`               | нові екрани                                                                        |
| `pages/jobs/model/describe-item.ts`                                                             | `quotaExceeded`                                                                    |
| `test/session.ts`, `test/server.ts`, `test/fixtures.ts`, `test/render-app.tsx`, `test/setup.ts` | тестова сесія замість ключа                                                        |
| `locales/{en,uk}/auth.json`, `assets.json`, `settings.json`                                     | нові простори імен                                                                 |

**Відхилення від специфікації, зафіксовані тут:** плитка файлу (`AssetTile`) живе в `pages/library/ui`, бо їй потрібні `STATUS_LABEL_KEY` з `features/jobs`, а фіча не може імпортувати фічу; `LanguageSwitch` переїжджає з `app/layouts` у `features/language`, бо сторінка налаштувань не може імпортувати `app`; веб тепер надсилає `name` у `POST /v1/uploads` (без цього пошук за назвою не має що шукати). Задача 13 вносить ці три пункти в специфікацію.

---

## Задача 1: фільтри `status` і `q` у `GET /v1/assets`

**Files:**

- Modify: `libs/contracts/src/assets.ts`, `libs/contracts/src/assets.spec.ts`
- Modify: `apps/metadata/src/assets/assets.service.ts`
- Modify: `libs/metadata-client/src/metadata-client.ts`
- Modify: `apps/api-gateway/src/assets/assets.dto.ts`
- Test: `test/assets.int-spec.ts`

**Interfaces:**

```ts
// libs/contracts/src/assets.ts
export const ASSET_STATUSES = ['processing', 'ready', 'failed'] as const;
export const AssetStatusSchema: z.ZodEnum<…>;
export type AssetStatus = 'processing' | 'ready' | 'failed';
export const ASSET_SEARCH_MAX_LENGTH = 100;
// ListAssetsQuery: + status?: AssetStatus, + q?: string (обрізаний; порожній → undefined; ≤ 100)
```

- [ ] **Step 1: падаючий тест контракту**

Додати в кінець `libs/contracts/src/assets.spec.ts` (імпорт `ListAssetsQuery` — з `./assets`, якщо його ще немає у файлі):

```ts
describe('ListAssetsQuery filters', () => {
  const base = { userId: '00000000-0000-4000-8000-000000000001' };

  it('accepts a status and a trimmed search', () => {
    expect(ListAssetsQuery.parse({ ...base, status: 'failed', q: '  harbour ' })).toMatchObject({
      status: 'failed',
      q: 'harbour',
    });
  });

  it('treats a blank search as no search', () => {
    expect(ListAssetsQuery.parse({ ...base, q: '   ' }).q).toBeUndefined();
  });

  it('rejects an unknown status and a search over 100 characters', () => {
    expect(ListAssetsQuery.safeParse({ ...base, status: 'done' }).success).toBe(false);
    expect(ListAssetsQuery.safeParse({ ...base, q: 'x'.repeat(101) }).success).toBe(false);
  });
});
```

Run: `pnpm test -- libs/contracts/src/assets.spec.ts` → FAIL (`status` відкидається як невідомий ключ або ігнорується; `q` не обрізається).

- [ ] **Step 2: контракт**

У `libs/contracts/src/assets.ts` поруч з `AssetKindSchema`:

```ts
/** What the latest job on a file says about it; see the Metadata list query. */
export const ASSET_STATUSES = ['processing', 'ready', 'failed'] as const;
export const AssetStatusSchema = z.enum(ASSET_STATUSES);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

export const ASSET_SEARCH_MAX_LENGTH = 100;
```

і замінити `ListAssetsQuery`:

```ts
export const ListAssetsQuery = z.object({
  userId: z.uuid(),
  kind: AssetKindSchema.optional(),
  status: AssetStatusSchema.optional(),
  q: z
    .string()
    .trim()
    .max(ASSET_SEARCH_MAX_LENGTH)
    .transform((value) => value || undefined)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
```

Тип `ListAssetsQuery` під схемою лишається як є. Якщо `libs/contracts/src/index.ts` перелічує експорти поіменно — додати `ASSET_STATUSES`, `AssetStatusSchema`, `AssetStatus`, `ASSET_SEARCH_MAX_LENGTH`.

Run: `pnpm test -- libs/contracts/src/assets.spec.ts` → PASS.

- [ ] **Step 3: падаючі інтеграційні тести**

У `test/assets.int-spec.ts` всередині `describe('media library', …)`, після тесту `'filters photos from videos and pages with a cursor'`:

```ts
/** A job attaches the upload to the library; these tests do not wait for it to finish. */
async function attached(key: string, name: string) {
  const asset = await upload(key, await pngImage(40, 30), { name });
  await resize(key, asset.sourceKey);
  return asset;
}

it('narrows the library by what the latest job says', async () => {
  const key = await newUser();
  const ready = await processedImage(key, 'ready.png');
  const failed = await processedImage(key, 'failed.png');
  await pool.query(`UPDATE jobs SET status = 'dead', dead_reason = 'permanent' WHERE id = $1`, [
    failed.jobId,
  ]);
  // No video worker runs here: the job stays queued.
  const video = await upload(key, Buffer.from('waits for a video worker'), {
    contentType: 'video/mp4',
    name: 'clip.mp4',
  });
  await createJob(key, { type: 'video.frames', sourceKey: video.sourceKey });

  const idsWith = async (status: string) =>
    (await api<{ items: Summary[] }>(key, `/v1/assets?status=${status}`)).body.items.map(
      (a) => a.id,
    );
  expect(await idsWith('ready')).toEqual([ready.assetId]);
  expect(await idsWith('failed')).toEqual([failed.assetId]);
  expect(await idsWith('processing')).toEqual([video.assetId]);
});

it('finds files by part of the name, taking % and _ literally', async () => {
  const key = await newUser();
  await attached(key, 'Harbour at dawn.png');
  await attached(key, 'cliffs_100%.png');
  await attached(key, 'cliffsX100Y.png');

  const namesFor = async (q: string) =>
    (await api<{ items: Summary[] }>(key, `/v1/assets?q=${encodeURIComponent(q)}`)).body.items.map(
      (a) => a.name,
    );
  expect(await namesFor('HARBOUR')).toEqual(['Harbour at dawn.png']);
  expect(await namesFor('_100%')).toEqual(['cliffs_100%.png']);
  expect(await namesFor('nothing like it')).toEqual([]);
});

it('rejects an unknown status and an overlong search', async () => {
  const key = await newUser();
  expect((await api(key, '/v1/assets?status=done')).status).toBe(400);
  expect((await api(key, `/v1/assets?q=${'x'.repeat(101)}`)).status).toBe(400);
});
```

Run: `pnpm test:int -- test/assets.int-spec.ts` → FAIL (шлюз не знає `status`/`q`; фільтри не застосовуються).

- [ ] **Step 4: Metadata — фільтри**

У `apps/metadata/src/assets/assets.service.ts` додати імпорти `ilike` (з `drizzle-orm`), `type AssetStatus`, `type JobStatus` (з `@pdp/contracts`; якщо `JobStatus` експортується під іншим ім'ям — візьміть те, на якому побудовано `ACTIVE_STATUSES`) і на рівні модуля:

```ts
const JOB_STATUSES_OF: Record<AssetStatus, JobStatus[]> = {
  processing: ['queued', 'scheduled', 'running'],
  ready: ['succeeded'],
  failed: ['failed', 'dead'],
};

/** `%`, `_` and `\` match themselves; `\` is Postgres' default LIKE escape. */
function containing(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
```

У `list()` після рядка з `query.kind`:

```ts
if (query.status) {
  const latestJobStatus = sql`(
        SELECT ${jobs.status} FROM ${jobs}
        WHERE ${jobs.assetId} = ${assets.id}
        ORDER BY ${jobs.createdAt} DESC, ${jobs.id} DESC
        LIMIT 1
      )`;
  filters.push(inArray(latestJobStatus, JOB_STATUSES_OF[query.status]));
}
if (query.q) filters.push(ilike(assets.name, containing(query.q)));
```

Підзапит читає одну задачу з `jobs_asset_created_idx` на кожен файл сторінки.

- [ ] **Step 5: клієнт і DTO шлюзу**

`libs/metadata-client/src/metadata-client.ts`, у `listAssets` поруч із `kind`:

```ts
if (query.status) params.set('status', query.status);
if (query.q) params.set('q', query.q);
```

`apps/api-gateway/src/assets/assets.dto.ts`, у `ListAssetsQueryDto` після `kind` (імпорти `ASSET_STATUSES`, `ASSET_SEARCH_MAX_LENGTH`, `type AssetStatus` — з `@pdp/contracts`):

```ts
  @ApiPropertyOptional({
    enum: ASSET_STATUSES,
    description: 'What the latest job says: processing, ready or failed.',
  })
  @IsOptional()
  @IsIn(ASSET_STATUSES)
  status?: AssetStatus;

  @ApiPropertyOptional({
    maxLength: ASSET_SEARCH_MAX_LENGTH,
    description: 'Part of the file name, case-insensitive.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ASSET_SEARCH_MAX_LENGTH)
  q?: string;
```

Контролер шлюзу вже розгортає `...query` у `metadata.listAssets` — змін не треба.

Run: `pnpm test:int -- test/assets.int-spec.ts` → PASS.
Run: `pnpm typecheck && pnpm lint && pnpm test` → PASS.

- [ ] **Step 6: коміт**

```bash
git add libs/contracts/src apps/metadata/src/assets apps/api-gateway/src/assets libs/metadata-client/src test/assets.int-spec.ts
git commit -m "feat(stage-5c.4): filter the library by status and name

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 2: `downloadUrl` для оригіналу й версій

**Files:**

- Modify: `apps/api-gateway/src/storage/storage.service.ts`
- Modify: `apps/api-gateway/src/jobs/job-presenter.ts`, `apps/api-gateway/src/jobs/jobs.dto.ts`
- Create: `apps/api-gateway/src/jobs/job-presenter.spec.ts`
- Modify: `apps/api-gateway/src/assets/assets.controller.ts`, `apps/api-gateway/src/assets/assets.dto.ts`
- Test: `test/assets.int-spec.ts`

**Interfaces:**

```ts
// storage.service.ts
presignGet(key: string, expiresIn: number, options?: { downloadName?: string }): Promise<string>;

// job-presenter.ts
export function originalNameOf(asset: { name: string | null; key: string }): string;
export function downloadNameOf(original: string, suffix: string, key: string): string;
toResponse(job: JobDto, options?: { downloadBase?: string }): Promise<JobResponseDto>;
```

Правило імен: оригінал — `asset.name` або останній сегмент ключа; версія — `<ім'я оригіналу без розширення>-<суфікс>.<розширення ключа версії>`. Суфікси: `preset` результату зображення (`thumb`, `medium`…), `rendition` (`480p`, `720p`), `preview`, `frame-0001` (номер кадру з 1, чотири цифри — як у файлах video-worker).

- [ ] **Step 1: падаючий юніт-тест імен**

`apps/api-gateway/src/jobs/job-presenter.spec.ts`:

```ts
import { downloadNameOf, originalNameOf } from './job-presenter';

describe('download names', () => {
  it('uses the uploaded name, or the last part of the key', () => {
    expect(originalNameOf({ name: 'Harbour.JPG', key: 'u/1/abc' })).toBe('Harbour.JPG');
    expect(originalNameOf({ name: null, key: 'u/1/abc.png' })).toBe('abc.png');
  });

  it('names a version after the original, with a suffix and the format of the version', () => {
    expect(downloadNameOf('Harbour.JPG', 'thumb', 'r/1/thumb.webp')).toBe('Harbour-thumb.webp');
    expect(downloadNameOf('clip.final.mp4', '480p', 'r/1/480p.mp4')).toBe('clip.final-480p.mp4');
    expect(downloadNameOf('noext', 'preview', 'r/1/preview.jpg')).toBe('noext-preview.jpg');
    expect(downloadNameOf('.hidden', 'thumb', 'r/1/thumb')).toBe('.hidden-thumb');
  });
});
```

Run: `pnpm test -- apps/api-gateway/src/jobs/job-presenter.spec.ts` → FAIL (функцій немає).

- [ ] **Step 2: storage — `Content-Disposition`**

У `storage.service.ts` замінити `presignGet`:

```ts
  /** With `downloadName`, browsers save the file under that name instead of opening it. */
  presignGet(
    key: string,
    expiresIn: number,
    { downloadName }: { downloadName?: string } = {},
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(downloadName !== undefined && {
        ResponseContentDisposition: `attachment; filename*=UTF-8''${rfc5987(downloadName)}`,
      }),
    });
    return getSignedUrl(this.signer, command, { expiresIn });
  }
```

і функцію модуля в кінці файлу:

```ts
/** `encodeURIComponent` leaves `'()*` as they are, which the header grammar does not allow. */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
```

- [ ] **Step 3: презентер**

У `job-presenter.ts` додати функції модуля:

```ts
export function originalNameOf({ name, key }: { name: string | null; key: string }): string {
  return name ?? key.slice(key.lastIndexOf('/') + 1);
}

function splitExtension(fileName: string): [base: string, extension: string] {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot + 1)] : [fileName, ''];
}

export function downloadNameOf(original: string, suffix: string, key: string): string {
  const [base] = splitExtension(original);
  const [, extension] = splitExtension(key.slice(key.lastIndexOf('/') + 1));
  return extension ? `${base}-${suffix}.${extension}` : `${base}-${suffix}`;
}
```

Змінити `toResponse` і приватні хелпери так, щоб кожне посилання будувалося одним методом:

```ts
  /**
   * Presigning is a local HMAC, so result URLs are cheap enough to include in lists too.
   * `downloadBase` (the original's file name) adds a `downloadUrl` that saves under a
   * matching name; only the asset details ask for it.
   */
  async toResponse(job: JobDto, { downloadBase }: { downloadBase?: string } = {}): Promise<JobResponseDto> {
    const link = async (key: string, suffix: string) => ({
      url: await this.presign(key),
      ...(downloadBase !== undefined && {
        downloadUrl: await this.storage.presignGet(key, RESULT_URL_TTL_S, {
          downloadName: downloadNameOf(downloadBase, suffix, key),
        }),
      }),
    });
    const frame = async ({ key, ...rest }: VideoFrame, suffix: string): Promise<VideoFrameDto> => ({
      ...rest,
      ...(await link(key, suffix)),
    });
    const frameSuffix = (index: number) => `frame-${String(index + 1).padStart(4, '0')}`;

    const response: JobResponseDto = { /* без змін */ };
    if (job.status !== 'succeeded') return response;

    if (job.type === 'image.resize') {
      const output = ImageResizeOutputV1.safeParse(job.output);
      if (!output.success) return response;
      response.results = await Promise.all(
        output.data.results.map(async ({ key, ...result }) => ({
          ...result,
          ...(await link(key, result.preset)),
        })),
      );
    }
    if (job.type === 'video.frames') {
      const output = VideoFramesOutputV1.safeParse(job.output);
      if (!output.success) return response;
      const { preview, frames, ...video } = output.data;
      response.video = {
        ...video,
        preview: await frame(preview, 'preview'),
        frames: await Promise.all(frames.map((f, index) => frame(f, frameSuffix(index)))),
      };
    }
    if (job.type === 'video.transcode') {
      const output = VideoTranscodeOutputV1.safeParse(job.output);
      if (!output.success) return response;
      const { preview, renditions, ...video } = output.data;
      response.transcode = {
        ...video,
        preview: await frame(preview, 'preview'),
        renditions: await Promise.all(
          renditions.map(async ({ key, ...rendition }) => ({
            ...rendition,
            ...(await link(key, rendition.rendition)),
          })),
        ),
      };
    }
    return response;
  }
```

Приватний `presignFrame` видалити. `presign(key)` лишається публічним (ним користується контролер файлів). `GET /v1/jobs` викликає `toResponse(job)` без опцій — його відповідь не змінюється.

`jobs.dto.ts`: у `JobResultDto`, `VideoFrameDto` і `RenditionDto` після `url` додати:

```ts
  @ApiPropertyOptional({
    description: 'Presigned GET URL that saves the file under a readable name. Asset details only.',
  })
  downloadUrl?: string;
```

(`ApiPropertyOptional` — додати до імпорту з `@nestjs/swagger`, якщо його там немає.)

- [ ] **Step 4: контролер файлу**

`assets.controller.ts`: інжектувати `StorageService` (у модулі шлюзу він уже провайдер — ним користується презентер) і змінити повернення в `get`:

```ts
  constructor(
    @Inject(MetadataClient) private readonly metadata: MetadataClient,
    private readonly presenter: JobPresenter,
    private readonly storage: StorageService,
  ) {}
```

```ts
const original = originalNameOf(asset);
return {
  ...toDto(asset),
  originalUrl: await this.presenter.presign(asset.key),
  originalDownloadUrl: await this.storage.presignGet(asset.key, RESULT_URL_TTL_S, {
    downloadName: original,
  }),
  jobs: await Promise.all(
    jobs.items.map((job) => this.presenter.toResponse(job, { downloadBase: original })),
  ),
  jobsNextCursor: jobs.nextCursor,
};
```

(Імпорти `originalNameOf`, `RESULT_URL_TTL_S` — з `../jobs/job-presenter`, `StorageService` — з `../storage/storage.service`.)

`assets.dto.ts`, у `AssetDetailsDto` після `originalUrl`:

```ts
  @ApiProperty({
    description: 'Presigned GET URL that saves the original under its uploaded name, valid for one hour.',
  })
  originalDownloadUrl!: string;
```

- [ ] **Step 5: інтеграційний тест**

У `test/assets.int-spec.ts`: в інтерфейс `Details` додати `originalDownloadUrl: string;` і `downloadUrl?: string` до елементів `results`:

```ts
interface Details extends Omit<Summary, 'preview' | 'latestJob'> {
  originalUrl: string;
  originalDownloadUrl: string;
  jobs: {
    id: string;
    status: string;
    results?: { preset: string; url: string; downloadUrl?: string }[];
  }[];
  jobsNextCursor: string | null;
}
```

і тести:

```ts
it('offers downloads named after the original', async () => {
  const key = await newUser();
  const { assetId } = await processedImage(key, 'Harbour at dawn.png');
  const { body } = await api<Details>(key, `/v1/assets/${assetId}`);

  const original = await fetch(body.originalDownloadUrl);
  expect(original.status).toBe(200);
  expect(original.headers.get('content-disposition')).toBe(
    `attachment; filename*=UTF-8''Harbour%20at%20dawn.png`,
  );

  const thumb = body.jobs[0]?.results?.find((r) => r.preset === 'thumb');
  expect(thumb?.downloadUrl).toBeDefined();
  const version = await fetch(thumb?.downloadUrl ?? '');
  expect(version.headers.get('content-disposition')).toBe(
    `attachment; filename*=UTF-8''Harbour%20at%20dawn-thumb.webp`,
  );
});

it('keeps job listings free of download links', async () => {
  const key = await newUser();
  await processedImage(key);
  const { body } = await api<{ items: { results?: { downloadUrl?: string }[] }[] }>(
    key,
    '/v1/jobs',
  );
  expect(body.items[0]?.results?.[0]).toBeDefined();
  expect(body.items[0]?.results?.[0]?.downloadUrl).toBeUndefined();
});
```

Run: `pnpm test -- apps/api-gateway && pnpm test:int -- test/assets.int-spec.ts` → PASS.
Run: `pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 6: коміт**

```bash
git add apps/api-gateway/src test/assets.int-spec.ts
git commit -m "feat(stage-5c.4): sign download links for the original and its versions

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 3: `seed-user --email --password`

**Files:**

- Modify: `apps/metadata/src/seed-user.ts`
- Create: `apps/metadata/src/seed-user.spec.ts`
- Modify: `test/auth.int-spec.ts`
- Modify: `scripts/perf.sh`, `scripts/autoscale-demo.sh`

**Interfaces:**

```ts
export interface SeedUserOptions {
  apiKey?: string;
  email?: string;
  password?: string;
}
export async function seedUser(
  databaseUrl: string,
  name: string,
  options?: SeedUserOptions,
): Promise<{ userId: string; apiKey: string; email: string | null }>;
```

- [ ] **Step 1: падаючі тести**

`apps/metadata/src/seed-user.spec.ts` (перевірка спрацьовує до підключення до БД, тому URL не використовується):

```ts
import { seedUser } from './seed-user';

describe('seedUser', () => {
  it('wants an email and a password together', async () => {
    await expect(seedUser('postgres://unused', 'x', { email: 'a@example.com' })).rejects.toThrow(
      'pass --email and --password together',
    );
    await expect(seedUser('postgres://unused', 'x', { password: 'long enough' })).rejects.toThrow(
      'pass --email and --password together',
    );
  });

  it('checks the email and the password like sign-up does', async () => {
    await expect(
      seedUser('postgres://unused', 'x', { email: 'nope', password: 'long enough' }),
    ).rejects.toThrow();
    await expect(
      seedUser('postgres://unused', 'x', { email: 'a@example.com', password: 'short' }),
    ).rejects.toThrow();
  });
});
```

У `test/auth.int-spec.ts` (імпорт `seedUser` з `../apps/metadata/src/seed-user`) — новий тест у головному `describe`:

```ts
it('signs in a user seeded with an email and a password', async () => {
  const email = newEmail();
  await seedUser(infra.databaseUrl, 'seeded', { email: email.toUpperCase(), password: PASSWORD });

  const res = await call('POST', '/v1/auth/login', { body: { email, password: PASSWORD } });
  expect(res.status).toBe(200);
});
```

Run: `pnpm test -- apps/metadata/src/seed-user.spec.ts` → FAIL (третій аргумент — рядок API-ключа).

- [ ] **Step 2: реалізація**

`apps/metadata/src/seed-user.ts`:

```ts
import {
  apiKeyPrefix,
  EmailSchema,
  generateApiKey,
  hashApiKey,
  PasswordSchema,
} from '@pdp/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { hashPassword } from './auth/passwords';
import { apiKeys, auditLog, users } from './database/schema';

export interface SeedUserOptions {
  /** A known key for local dev and tests; otherwise one is generated. */
  apiKey?: string;
  email?: string;
  password?: string;
}

/**
 * Creates a user and prints its API key once; only hashes are stored. With `--email` and
 * `--password` the user can also sign in to the web app.
 */
export async function seedUser(
  databaseUrl: string,
  name: string,
  { apiKey = generateApiKey(), email, password }: SeedUserOptions = {},
): Promise<{ userId: string; apiKey: string; email: string | null }> {
  if ((email === undefined) !== (password === undefined)) {
    throw new Error('seed-user: pass --email and --password together');
  }
  const normalizedEmail = email === undefined ? null : EmailSchema.parse(email);
  const passwordHash =
    password === undefined ? null : await hashPassword(PasswordSchema.parse(password));

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool);
    const userId = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ name, email: normalizedEmail, passwordHash })
        .returning({ id: users.id });
      if (!user) throw new Error('insert returned no row');
      await tx.insert(apiKeys).values({
        userId: user.id,
        name: 'default',
        hash: hashApiKey(apiKey),
        prefix: apiKeyPrefix(apiKey),
      });
      await tx
        .insert(auditLog)
        .values({ actor: 'cli', action: 'user.created', entityId: user.id, data: { name } });
      return user.id;
    });
    return { userId, apiKey, email: normalizedEmail };
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const { values } = parseArgs({
    options: {
      name: { type: 'string', default: 'dev' },
      'api-key': { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
    },
  });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  seedUser(url, values.name, {
    apiKey: values['api-key'],
    email: values.email,
    password: values.password,
  }).then(
    (result) => console.log(JSON.stringify(result)),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
```

Сигнатуру `hashPassword` перевірте в `apps/metadata/src/auth/passwords.ts` (очікується `(password: string) => Promise<string>`). Якщо `exactOptionalPropertyTypes` увімкнено і `values['api-key']` має тип `string | undefined` — передавайте `...(values['api-key'] && { apiKey: values['api-key'] })` тощо.

У `scripts/perf.sh` і `scripts/autoscale-demo.sh` замінити третій аргумент:

```js
await seedUser(process.env.DATABASE_URL, 'perf-' + id, { apiKey: 'pdp_perf_' + id + '_local' });
```

Run: `pnpm test -- apps/metadata/src/seed-user.spec.ts` → PASS.
Run: `pnpm test:int -- test/auth.int-spec.ts` → PASS.
Run: `pnpm typecheck && pnpm lint && pnpm test` → PASS.

- [ ] **Step 3: коміт**

```bash
git add apps/metadata/src/seed-user.ts apps/metadata/src/seed-user.spec.ts test/auth.int-spec.ts scripts/perf.sh scripts/autoscale-demo.sh
git commit -m "feat(stage-5c.4): seed a user who signs in with email and password

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 4: `AppError.code` і `appErrorOf`

**Files:**

- Modify: `apps/web/src/shared/api/http.ts`
- Test: `apps/web/src/shared/api/http.test.ts`

**Interfaces:**

```ts
export type AppError =
  | { kind: 'unauthorized' }
  | { kind: 'network' }
  | { kind: 'cancelled' }
  | { kind: 'retryLater'; status: 429 | 503; retryAfterS: number }
  | { kind: 'http'; status: number; message: string; code: string | null };

/** What `unwrap()` rejects with is `unknown`; this narrows it back. */
export function appErrorOf(value: unknown): AppError | null;
/** The gateway's machine-readable reason (`EMAIL_TAKEN`, `ASSET_BUSY`, …), if any. */
export function errorCodeOf(value: unknown): string | null;
// retryAfterOf / isUnauthorized тепер приймають `unknown`
```

- [ ] **Step 1: падаючі тести**

Замінити вміст `apps/web/src/shared/api/http.test.ts`:

```ts
import { http as mock, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { appErrorOf, errorCodeOf, http, isUnauthorized, retryAfterOf, toAppError } from './http';

describe('AppError helpers', () => {
  it('reads Retry-After only from refusals about timing', () => {
    expect(retryAfterOf({ kind: 'retryLater', status: 429, retryAfterS: 3 })).toBe(3);
    expect(retryAfterOf({ kind: 'network' })).toBeNull();
    expect(retryAfterOf({ message: 'serialized' })).toBeNull();
    expect(retryAfterOf(undefined)).toBeNull();
  });

  it('recognises a rejected sign-in', () => {
    expect(isUnauthorized({ kind: 'unauthorized' })).toBe(true);
    expect(isUnauthorized({ kind: 'http', status: 403, message: 'no', code: null })).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });

  it('narrows unknown values to app errors and nothing else', () => {
    expect(appErrorOf({ kind: 'network' })).toEqual({ kind: 'network' });
    expect(appErrorOf({ kind: 'other' })).toBeNull();
    expect(appErrorOf({ name: 'Error', message: 'boom' })).toBeNull();
    expect(appErrorOf('network')).toBeNull();
    expect(appErrorOf(null)).toBeNull();
  });
});

describe('toAppError', () => {
  it('keeps the code the gateway gave for a refusal', async () => {
    server.use(
      mock.post('/v1/auth/register', () =>
        HttpResponse.json(
          { statusCode: 409, code: 'EMAIL_TAKEN', message: 'email is already registered' },
          { status: 409 },
        ),
      ),
    );
    const error = await http.post('/v1/auth/register', {}).then(() => null, toAppError);

    expect(error).toEqual({
      kind: 'http',
      status: 409,
      message: 'email is already registered',
      code: 'EMAIL_TAKEN',
    });
    expect(errorCodeOf(error)).toBe('EMAIL_TAKEN');
  });

  it('has no code when the body has none', async () => {
    server.use(mock.get('/v1/jobs', () => HttpResponse.json({ message: 'bad' }, { status: 400 })));
    const error = await http.get('/v1/jobs').then(() => null, toAppError);

    expect(error).toEqual({ kind: 'http', status: 400, message: 'bad', code: null });
    expect(errorCodeOf(error)).toBeNull();
    expect(errorCodeOf({ kind: 'network' })).toBeNull();
  });
});
```

Run: `cd apps/web && pnpm vitest run src/shared/api/http.test.ts` → FAIL (немає `appErrorOf`, `errorCodeOf`; `code` відсутній).

- [ ] **Step 2: реалізація**

У `http.ts`:

1. Варіант `http` в `AppError` отримує `code: string | null` (див. Interfaces).
2. Поруч з `messageOf`:

```ts
function codeOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('code' in data)) return null;
  return typeof data.code === 'string' ? data.code : null;
}
```

3. Останній рядок `toAppError`:

```ts
return {
  kind: 'http',
  status,
  message: messageOf(error.response?.data) ?? error.message,
  code: codeOf(error.response?.data),
};
```

4. Замінити `type QueryError` і `isAppError` на:

```ts
const APP_ERROR_KINDS: ReadonlySet<unknown> = new Set<AppError['kind']>([
  'unauthorized',
  'network',
  'cancelled',
  'retryLater',
  'http',
]);

function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    APP_ERROR_KINDS.has(value.kind)
  );
}

/** What `unwrap()` rejects with is `unknown`; this narrows it back. */
export function appErrorOf(value: unknown): AppError | null {
  return isAppError(value) ? value : null;
}

/** The gateway's machine-readable reason (`EMAIL_TAKEN`, `ASSET_BUSY`, …), if any. */
export function errorCodeOf(value: unknown): string | null {
  return isAppError(value) && value.kind === 'http' ? value.code : null;
}

/** Seconds the gateway asked to wait, if the request was refused for timing. */
export function retryAfterOf(error: unknown): number | null {
  return isAppError(error) && error.kind === 'retryLater' ? error.retryAfterS : null;
}

export function isUnauthorized(error: unknown): boolean {
  return isAppError(error) && error.kind === 'unauthorized';
}
```

Імпорт `type SerializedError` більше не потрібен — видалити.

Run: `cd apps/web && pnpm vitest run src/shared/api/http.test.ts` → PASS.
Run: `pnpm typecheck` — якщо десь будується літерал `{ kind: 'http', … }` без `code` (тести jobs/webhooks), додати `code: null`. Run: `pnpm test:web && pnpm lint` → PASS.

- [ ] **Step 3: коміт**

```bash
git add apps/web/src
git commit -m "feat(stage-5c.4): keep the gateway's error code on app errors

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 5: вхід email + паролем, фіча `auth`, без API-ключа в браузері

Найбільша задача етапу: змінює спосіб входу для всього застосунку, тож усе переходить одним комітом, щоб між комітами тести лишалися зеленими.

**Files:**

- Create: `apps/web/src/features/auth/index.ts`
- Create: `apps/web/src/features/auth/api/auth-api.ts`
- Create: `apps/web/src/features/auth/model/types.ts`, `model/signed-out.ts`, `model/validate.ts`, `model/validate.test.ts`, `model/auth-failure.ts`
- Create: `apps/web/src/features/auth/ui/AuthForm.module.css`, `ui/LoginForm.tsx`, `ui/FormFailure.tsx`
- Create: `apps/web/src/shared/lib/use-countdown.ts`, `use-countdown.test.ts`
- Create: `apps/web/src/locales/en/auth.json`, `apps/web/src/locales/uk/auth.json`
- Create: `apps/web/src/test/session.ts`
- Create: `apps/web/src/app/i18n.test.ts`
- Modify: `apps/web/src/shared/api/http.ts`, `apps/web/src/app/store.ts`, `apps/web/src/app/store.test.ts`, `apps/web/src/app/i18n.ts`
- Modify: `apps/web/src/app/layouts/AppRoot.tsx`, `RequireAuth.tsx`, `UserMenu.tsx`
- Modify: `apps/web/src/pages/login/LoginPage.tsx`, `apps/web/src/pages/page.module.css`
- Modify: `apps/web/src/test/fixtures.ts`, `test/server.ts`, `test/render-app.tsx`, `test/setup.ts`
- Modify: `apps/web/src/app/auth-flow.test.tsx`, `app/upload-dialog.test.tsx`, `pages/jobs/JobsPage.test.tsx`, `pages/webhooks/WebhooksPage.test.tsx` (та інші, що згадують `TEST_API_KEY`)
- Modify: `apps/web/src/locales/{en,uk}/shell.json`, `locales/{en,uk}/workspace.json` (`problem.unauthorized`)
- Delete: `apps/web/src/features/api-key/`, `apps/web/src/features/session/`, `apps/web/src/locales/{en,uk}/apiKey.json`

**Interfaces:**

```ts
// features/auth/index.ts
export { useGetMeQuery, useLoginMutation, useRegisterMutation, useLogoutMutation, authApi } from './api/auth-api';
export { signedOut } from './model/signed-out';
export { type Me, type AuthMethod } from './model/types';
export { LoginForm } from './ui/LoginForm';
// (RegisterForm додає задача 6)

// shared/api/http.ts
interface HttpHooks { onUnauthorized: (url: string) => void }

// shared/lib/use-countdown.ts
export function useCountdown(): [secondsLeft: number, start: (seconds: number) => void];

// test/session.ts
export const testSession: { signIn(): void; signOut(): void; isSignedIn(): boolean };

// test/render-app.tsx
export function renderApp(options?: { signedIn?: boolean; route?: string }): …;
```

- [ ] **Step 1: зворотний відлік (TDD)**

`apps/web/src/shared/lib/use-countdown.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { useCountdown } from './use-countdown';

describe('useCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts whole seconds down to zero and stops', () => {
    const { result } = renderHook(() => useCountdown());
    expect(result.current[0]).toBe(0);

    act(() => result.current[1](2));
    expect(result.current[0]).toBe(2);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current[0]).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current[0]).toBe(0);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current[0]).toBe(0);
  });

  it('starts over when started again', () => {
    const { result } = renderHook(() => useCountdown());
    act(() => result.current[1](5));
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current[1](10));
    expect(result.current[0]).toBe(10);
  });
});
```

Run: `cd apps/web && pnpm vitest run src/shared/lib/use-countdown.test.ts` → FAIL.

`apps/web/src/shared/lib/use-countdown.ts`:

```ts
import { useEffect, useState } from 'react';

const SECOND_MS = 1000;

/** Seconds left of a wait the server asked for; `start` begins a new one. */
export function useCountdown(): [secondsLeft: number, start: (seconds: number) => void] {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((left) => left - 1), SECOND_MS);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  return [secondsLeft, setSecondsLeft];
}
```

Run → PASS.

- [ ] **Step 2: клієнтська валідація (TDD)**

`apps/web/src/features/auth/model/validate.test.ts`:

```ts
import { emailProblem, nameProblem, passwordProblem } from './validate';

describe('sign-in rules', () => {
  it('wants an email that looks like one', () => {
    expect(emailProblem('')).toBe('required');
    expect(emailProblem('   ')).toBe('required');
    expect(emailProblem('alice')).toBe('format');
    expect(emailProblem('alice@example')).toBe('format');
    expect(emailProblem(' alice@example.com ')).toBeNull();
    expect(emailProblem(`${'a'.repeat(250)}@x.io`)).toBe('tooLong');
  });

  it('checks the length of a new password only', () => {
    expect(passwordProblem('', { isNew: false })).toBe('required');
    expect(passwordProblem('short', { isNew: false })).toBeNull();
    expect(passwordProblem('short', { isNew: true })).toBe('tooShort');
    expect(passwordProblem('long enough', { isNew: true })).toBeNull();
    expect(passwordProblem('x'.repeat(129), { isNew: true })).toBe('tooLong');
  });

  it('lets the name be empty but not too long', () => {
    expect(nameProblem('')).toBeNull();
    expect(nameProblem('x'.repeat(101))).toBe('tooLong');
  });
});
```

Run → FAIL. Потім `apps/web/src/features/auth/model/validate.ts`:

```ts
// Mirrors libs/contracts/src/accounts.ts: the web app does not depend on zod, and the
// gateway checks again, so these limits only spare a round trip.
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MAX_LENGTH = 100;

export type FieldProblem = 'required' | 'format' | 'tooShort' | 'tooLong';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailProblem(raw: string): FieldProblem | null {
  const email = raw.trim();
  if (!email) return 'required';
  if (email.length > EMAIL_MAX_LENGTH) return 'tooLong';
  return EMAIL_SHAPE.test(email) ? null : 'format';
}

/** Existing passwords may predate today's rules, so sign-in only checks they are there. */
export function passwordProblem(
  password: string,
  { isNew }: { isNew: boolean },
): FieldProblem | null {
  if (!password) return 'required';
  if (password.length > PASSWORD_MAX_LENGTH) return 'tooLong';
  return isNew && password.length < PASSWORD_MIN_LENGTH ? 'tooShort' : null;
}

export function nameProblem(raw: string): FieldProblem | null {
  return raw.trim().length > NAME_MAX_LENGTH ? 'tooLong' : null;
}
```

Межі звірено з `libs/contracts/src/accounts.ts`: `USER_NAME_MAX_LENGTH = 100`, `PASSWORD_MIN_LENGTH = 8`, `PASSWORD_MAX_LENGTH = 128`; email обмежує `EmailSchema` (254). Run → PASS.

- [ ] **Step 3: фіча `auth` — типи, API, дія виходу, розбір помилок**

`features/auth/model/types.ts`:

```ts
export type AuthMethod = 'api-key' | 'session';

/** `GET /v1/me`: the signed-in user and how this request was authenticated. */
export type Me = {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  authMethod: AuthMethod;
};

export type Credentials = { email: string; password: string };
export type Registration = Credentials & { name?: string };
```

`features/auth/model/signed-out.ts`:

```ts
import { createAction } from '@reduxjs/toolkit';

/** The session is over: the store drops everything that belonged to it. */
export const signedOut = createAction('auth/signedOut');
```

`features/auth/api/auth-api.ts`:

```ts
import { baseApi } from '../../../shared/api/base-api';
import { type Credentials, type Me, type Registration } from '../model/types';

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // Errors provide no tag: invalidating `Me` after a 401 must not refetch it in a loop.
    getMe: build.query<Me, void>({
      query: () => ({ url: '/v1/me' }),
      providesTags: (result) => (result ? ['Me'] : []),
    }),
    login: build.mutation<unknown, Credentials>({
      query: (body) => ({ url: '/v1/auth/login', method: 'POST', data: body }),
    }),
    register: build.mutation<unknown, Registration>({
      query: (body) => ({ url: '/v1/auth/register', method: 'POST', data: body }),
    }),
    logout: build.mutation<void, void>({
      query: () => ({ url: '/v1/auth/logout', method: 'POST' }),
    }),
  }),
});

export const { useGetMeQuery, useLoginMutation, useRegisterMutation, useLogoutMutation } = authApi;
```

(Відповідь `login`/`register` не читається: після успіху стор скидає кеш, і `getMe` перезапитується.)

`features/auth/model/auth-failure.ts`:

```ts
import { appErrorOf } from '../../../shared/api/http';

/** Why the gateway refused a sign-in or a sign-up, in terms the form can show. */
export type AuthFailure =
  | { kind: 'credentials' }
  | { kind: 'emailTaken' }
  | { kind: 'retryLater'; retryAfterS: number }
  | { kind: 'refused'; message: string }
  | { kind: 'unavailable' };

export function authFailureOf(error: unknown): AuthFailure {
  const appError = appErrorOf(error);
  switch (appError?.kind) {
    case 'unauthorized':
      return { kind: 'credentials' };
    case 'retryLater':
      return { kind: 'retryLater', retryAfterS: appError.retryAfterS };
    case 'http':
      if (appError.code === 'EMAIL_TAKEN') return { kind: 'emailTaken' };
      return appError.status >= 500
        ? { kind: 'unavailable' }
        : { kind: 'refused', message: appError.message };
    default:
      return { kind: 'unavailable' };
  }
}
```

- [ ] **Step 4: тексти `auth`**

`apps/web/src/locales/en/auth.json`:

```json
{
  "email": "Email",
  "password": "Password",
  "name": "Name",
  "nameHint": "Optional. Shown in the menu instead of your email.",
  "newPasswordHint": "At least {{count}} characters.",
  "login": {
    "submit": "Sign in",
    "noAccount": "No account yet?",
    "toRegister": "Create one"
  },
  "register": {
    "submit": "Create account",
    "haveAccount": "Already have an account?",
    "toLogin": "Sign in"
  },
  "problem": {
    "email": {
      "required": "Enter your email.",
      "format": "Enter an email like name@example.com.",
      "tooLong": "This email is too long."
    },
    "password": {
      "required": "Enter your password.",
      "tooShort": "Use at least {{count}} characters.",
      "tooLong": "Use at most {{count}} characters."
    },
    "name": {
      "tooLong": "Use at most {{count}} characters."
    }
  },
  "failure": {
    "credentials": "Wrong email or password.",
    "emailTaken": "This email is already registered.",
    "emailTakenAction": "Sign in instead",
    "retryLater_one": "Too many attempts. Try again in {{count}} second.",
    "retryLater_other": "Too many attempts. Try again in {{count}} seconds.",
    "refused": "The server refused: {{message}}",
    "unavailable": "Could not reach the server. Try again."
  }
}
```

`apps/web/src/locales/uk/auth.json`:

```json
{
  "email": "Email",
  "password": "Пароль",
  "name": "Ім'я",
  "nameHint": "Необов'язково. Показується в меню замість email.",
  "newPasswordHint": "Щонайменше {{count}} символів.",
  "login": {
    "submit": "Увійти",
    "noAccount": "Немає акаунта?",
    "toRegister": "Зареєструватися"
  },
  "register": {
    "submit": "Зареєструватися",
    "haveAccount": "Уже маєте акаунт?",
    "toLogin": "Увійти"
  },
  "problem": {
    "email": {
      "required": "Введіть email.",
      "format": "Введіть email у вигляді name@example.com.",
      "tooLong": "Email задовгий."
    },
    "password": {
      "required": "Введіть пароль.",
      "tooShort": "Щонайменше {{count}} символів.",
      "tooLong": "Щонайбільше {{count}} символів."
    },
    "name": {
      "tooLong": "Щонайбільше {{count}} символів."
    }
  },
  "failure": {
    "credentials": "Невірний email або пароль.",
    "emailTaken": "Цей email уже зареєстровано.",
    "emailTakenAction": "Увійти",
    "retryLater_one": "Забагато спроб. Спробуйте через {{count}} секунду.",
    "retryLater_few": "Забагато спроб. Спробуйте через {{count}} секунди.",
    "retryLater_many": "Забагато спроб. Спробуйте через {{count}} секунд.",
    "retryLater_other": "Забагато спроб. Спробуйте через {{count}} секунди.",
    "refused": "Сервер відмовив: {{message}}",
    "unavailable": "Не вдалося зв'язатися з сервером. Спробуйте ще раз."
  }
}
```

Тест на однакові ключі в обох мовах (у проєкті його ще немає) — `app/i18n.test.ts`:

```ts
import { resources } from './i18n';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** Plural forms differ by language (uk has few/many), so only the base key must match. */
const baseKeys = (tree: unknown) =>
  [...new Set(keysOf(tree).map((key) => key.replace(PLURAL_SUFFIX, '')))].sort();

const uk = new Map<string, unknown>(Object.entries(resources.uk));

describe('translations', () => {
  it.each(Object.entries(resources.en))('has the same keys in both languages: %s', (ns, en) => {
    expect(baseKeys(uk.get(ns))).toEqual(baseKeys(en));
  });
});
```

Run: `cd apps/web && pnpm vitest run src/app/i18n.test.ts` → PASS (якщо падає на наявних просторах — виправити розбіжність у JSON, це справжня помилка перекладу).

`app/i18n.ts`: прибрати `apiKey` (імпорти, ресурси, `ns`), додати `auth` з `../locales/{en,uk}/auth.json`. Видалити `locales/{en,uk}/apiKey.json`.

`shell.json` (en/uk): видалити `registerPage.body`, `registerPage.toLogin`, `upload.openJobs` поки не чіпати (задача 9). `workspace.json`, `problem.unauthorized`: en — `"Your session has ended. Sign in again."`, uk — `"Сесія закінчилася. Увійдіть знову."`.

- [ ] **Step 5: `LoginForm`**

`features/auth/ui/AuthForm.module.css`:

```css
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 28rem;
  padding: var(--space-5);
  border-radius: var(--radius-mount);
  background: var(--mount);
  box-shadow: var(--shadow-mount);
}

.failure {
  margin: 0;
  color: var(--tone-danger-ink);
}

.submit {
  align-self: flex-start;
}
```

(Якщо токена `--tone-danger-ink` немає — візьміть той, яким `Field` фарбує помилку, з `Field.module.css`.)

`features/auth/ui/FormFailure.tsx` — спільне повідомлення про відмову сервера для обох форм:

```tsx
import { useTranslation } from 'react-i18next';
import { type AuthFailure } from '../model/auth-failure';
import styles from './AuthForm.module.css';

type FormFailureProps = { failure: AuthFailure | null; secondsLeft: number };

/** Field-level failures (`emailTaken`) are shown on the field instead. */
export function FormFailure({ failure, secondsLeft }: FormFailureProps) {
  const { t } = useTranslation('auth');
  const message = (() => {
    switch (failure?.kind) {
      case 'credentials':
        return t('failure.credentials');
      case 'retryLater':
        return secondsLeft > 0 ? t('failure.retryLater', { count: secondsLeft }) : null;
      case 'refused':
        return t('failure.refused', { message: failure.message });
      case 'unavailable':
        return t('failure.unavailable');
      default:
        return null;
    }
  })();
  return (
    <p role="alert" className={styles.failure}>
      {message}
    </p>
  );
}
```

(Регіон `role="alert"` рендериться завжди, порожнім, щоб скрінрідер оголосив текст, коли той з'явиться.)

`features/auth/ui/LoginForm.tsx`:

```tsx
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCountdown } from '../../../shared/lib/use-countdown';
import { Button } from '../../../shared/ui/button/Button';
import { Field } from '../../../shared/ui/field/Field';
import { Input } from '../../../shared/ui/field/Input';
import { useLoginMutation } from '../api/auth-api';
import { type AuthFailure, authFailureOf } from '../model/auth-failure';
import {
  emailProblem,
  type FieldProblem,
  PASSWORD_MAX_LENGTH,
  passwordProblem,
} from '../model/validate';
import styles from './AuthForm.module.css';
import { FormFailure } from './FormFailure';

type Problems = { email: FieldProblem | null; password: FieldProblem | null };
const NO_PROBLEMS: Problems = { email: null, password: null };

/** On success the store resets the API cache; the page sees `getMe` succeed and moves on. */
export function LoginForm() {
  const { t } = useTranslation('auth');
  const [login, { isLoading }] = useLoginMutation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [secondsLeft, startCountdown] = useCountdown();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = {
      email: emailProblem(email),
      password: passwordProblem(password, { isNew: false }),
    };
    setProblems(found);
    if (found.email) {
      emailRef.current?.focus();
      return;
    }
    if (found.password) {
      passwordRef.current?.focus();
      return;
    }

    setFailure(null);
    try {
      await login({ email: email.trim(), password }).unwrap();
    } catch (error) {
      const next = authFailureOf(error);
      setFailure(next);
      if (next.kind === 'retryLater') startCountdown(next.retryAfterS);
      if (next.kind === 'credentials') {
        setPassword('');
        passwordRef.current?.focus();
      }
    }
  };

  const problemText = (field: 'email' | 'password', problem: FieldProblem | null) =>
    problem ? t(`problem.${field}.${problem}`, { count: PASSWORD_MAX_LENGTH }) : undefined;

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void handleSubmit(event)}>
      <Field label={t('email')} error={problemText('email', problems.email)}>
        {(control) => (
          <Input
            {...control}
            ref={emailRef}
            type="email"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </Field>
      <Field label={t('password')} error={problemText('password', problems.password)}>
        {(control) => (
          <Input
            {...control}
            ref={passwordRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
      <FormFailure failure={failure} secondsLeft={secondsLeft} />
      <Button
        variant="primary"
        type="submit"
        className={styles.submit}
        isBusy={isLoading}
        disabled={secondsLeft > 0}
      >
        {t('login.submit')}
      </Button>
    </form>
  );
}
```

Ключі `problem.email.*` / `problem.password.*` будуються шаблоном: i18next у проєкті не типізований (немає `CustomTypeOptions`), тож `tsc` їх пропускає, а `app/i18n.test.ts` перевіряє, що набори ключів в обох мовах однакові. `Input` розгортає `...rest` на `<input>`, а в React 19 `ref` — звичайний проп, тож `ref={emailRef}` доходить до поля.

`features/auth/index.ts`:

```ts
export {
  authApi,
  useGetMeQuery,
  useLoginMutation,
  useLogoutMutation,
  useRegisterMutation,
} from './api/auth-api';
export { signedOut } from './model/signed-out';
export { type AuthMethod, type Me } from './model/types';
export { LoginForm } from './ui/LoginForm';
```

- [ ] **Step 6: HTTP без ключа**

`shared/api/http.ts`:

```ts
interface HttpHooks {
  /** `url` of the refused request; 401 from `/v1/auth/*` means a wrong password, not an ended session. */
  onUnauthorized: (url: string) => void;
}

let hooks: HttpHooks = { onUnauthorized: () => undefined };

/** Wired once by the app layer, so `shared` never imports the store. */
export function configureHttp(next: HttpHooks): void {
  hooks = next;
}

export const http = axios.create({ baseURL: '/', timeout: 15_000 });

http.interceptors.response.use(undefined, (error: unknown) => {
  if (isAxiosError(error) && error.response?.status === 401)
    hooks.onUnauthorized(error.config?.url ?? '');
  throw error;
});

/** Presigned URLs point straight at object storage on another origin: no interceptors. */
export const storageHttp = axios.create({ timeout: 120_000 });
```

`API_KEY_HEADER` і request-інтерсептор видалити.

- [ ] **Step 7: стор**

`app/store.ts` повністю:

```ts
import { combineSlices, configureStore, createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import { authApi, signedOut } from '../features/auth';
import { clearUploads, uploadsSlice } from '../features/upload';
import { baseApi } from '../shared/api/base-api';
import { configureHttp } from '../shared/api/http';
import { type ThunkExtra } from '../shared/lib/redux';

const rootReducer = combineSlices(uploadsSlice, baseApi);
export type RootState = ReturnType<typeof rootReducer>;

const AUTH_PATH = '/v1/auth/';

export function createStore() {
  const listener = createListenerMiddleware<RootState>();
  let session = new AbortController();
  const extra: ThunkExtra = { sessionSignal: () => session.signal };

  // A new identity, or none: the previous one's uploads and cached data must not leak into it.
  listener.startListening({
    matcher: isAnyOf(
      signedOut,
      authApi.endpoints.login.matchFulfilled,
      authApi.endpoints.register.matchFulfilled,
    ),
    effect: (_action, api) => {
      session.abort();
      session = new AbortController();
      api.dispatch(clearUploads());
      api.dispatch(baseApi.util.resetApiState());
    },
  });

  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefault) =>
      getDefault({ thunk: { extraArgument: extra } })
        .prepend(listener.middleware)
        .concat(baseApi.middleware),
  });

  configureHttp({
    onUnauthorized: (url) => {
      // A session that expired mid-work: the shell re-checks and sends the user to sign in.
      if (!url.startsWith(AUTH_PATH)) store.dispatch(baseApi.util.invalidateTags(['Me']));
    },
  });

  return store;
}

export type AppStore = ReturnType<typeof createStore>;
```

(URL у axios — той, що передали в `http.post('/v1/auth/login')`, тобто відносний; RTK-запити теж передають відносні `url`.)

`app/store.test.ts` повністю:

```ts
import { waitFor } from '@testing-library/react';
import { http as mock, HttpResponse } from 'msw';
import { authApi, signedOut } from '../features/auth';
import { http } from '../shared/api/http';
import { type ThunkExtra } from '../shared/lib/redux';
import { TEST_ME } from '../test/fixtures';
import { server } from '../test/server';
import { createStore } from './store';

const currentSignal = (store: ReturnType<typeof createStore>) =>
  store.dispatch((_dispatch: unknown, _getState: unknown, extra: ThunkExtra) =>
    extra.sessionSignal(),
  );

describe('session', () => {
  it('stops the work of a session that ends', () => {
    const store = createStore();
    const before = currentSignal(store);

    store.dispatch(signedOut());

    expect(before.aborted).toBe(true);
    expect(currentSignal(store).aborted).toBe(false);
  });

  it('re-checks who is signed in after a 401, but not after a wrong password', async () => {
    let meCalls = 0;
    server.use(
      mock.get('/v1/me', () => {
        meCalls += 1;
        return HttpResponse.json(TEST_ME);
      }),
      mock.post('/v1/auth/login', () => HttpResponse.json({ message: 'no' }, { status: 401 })),
      mock.get('/v1/jobs', () => new HttpResponse(null, { status: 401 })),
    );
    const store = createStore();
    await store.dispatch(authApi.endpoints.getMe.initiate());
    expect(meCalls).toBe(1);

    await http.post('/v1/auth/login', {}).catch(() => undefined);
    await http.get('/v1/jobs').catch(() => undefined);

    await waitFor(() => expect(meCalls).toBe(2));
  });
});
```

(Другий тест перевіряє обидва випадки одним лічильником: якби `401` від входу теж інвалідував `Me`, лічильник дійшов би до 3 — додайте в кінці `expect(meCalls).toBe(2)` після `await new Promise((r) => setTimeout(r, 50))`, щоб це зловити. Таймаут тут не гонка: він лише дає шанс зайвому запиту статися.) Якщо `store.dispatch` не приймає thunk з такою анотацією параметрів — використайте `ThunkAction<AbortSignal, RootState, ThunkExtra, UnknownAction>` з `@reduxjs/toolkit` як тип константи-thunk'а.

- [ ] **Step 8: shell — `AppRoot`, `RequireAuth`, `UserMenu`, `LoginPage`**

`app/layouts/AppRoot.tsx`:

```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { ToastProvider } from '../../shared/ui/toast/ToastProvider';

/** Where 5c.3 kept the API key; sign-in is a session cookie now. */
const LEGACY_API_KEY_STORAGE = 'pdp.apiKey';

/** Root of every route: toasts live inside the router, so their actions can be links. */
export function AppRoot() {
  const { t } = useTranslation('shell');
  useEffect(() => window.localStorage.removeItem(LEGACY_API_KEY_STORAGE), []);
  return (
    <ToastProvider closeLabel={t('close')}>
      <Outlet />
    </ToastProvider>
  );
}
```

`RequireAuth.tsx`: імпорт `useGetMeQuery` з `../../features/auth`; JSDoc — `/** The app shell is for signed-in users. */`.

`UserMenu.tsx`: імпорти `signedOut`, `useGetMeQuery`, `useLogoutMutation` з `../../features/auth` (без `features/api-key`, `features/session`); `signOut`:

```tsx
const signOut = async () => {
  try {
    await logout().unwrap();
  } catch {
    toast({ tone: 'danger', message: t('menu.signOutFailed') });
    return;
  }
  dispatch(signedOut());
  void navigate('/login');
};
```

`pages/login/LoginPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router';
import { LoginForm, useGetMeQuery } from '../../features/auth';
import { isUnauthorized, retryAfterOf } from '../../shared/api/http';
import { safeReturnTo } from '../../shared/lib/return-to';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import styles from '../page.module.css';

export function LoginPage() {
  const { t } = useTranslation('shell');
  const { t: tAuth } = useTranslation('auth');
  const [params] = useSearchParams();
  const me = useGetMeQuery();
  const next = params.get('next');

  if (me.data) return <Navigate to={safeReturnTo(next)} replace />;

  // A 401 just means "not signed in yet"; anything else is worth saying, but the form stays.
  const checkFailed = me.isError && !isUnauthorized(me.error);
  const retryAfterS = retryAfterOf(me.error);

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeading>{t('login.title')}</PageHeading>
      {checkFailed && (
        <ErrorState
          title={t('auth.unavailableTitle')}
          retry={{ label: t('retry'), onRetry: () => void me.refetch() }}
        >
          <p>
            {retryAfterS === null
              ? t('auth.unavailable')
              : t('auth.tooManyRequests', { count: retryAfterS })}
          </p>
        </ErrorState>
      )}
      {me.isLoading ? <Skeleton height="16rem" radius="mount" /> : <LoginForm />}
      <p className={styles.switch}>
        {tAuth('login.noAccount')}{' '}
        <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}>
          {tAuth('login.toRegister')}
        </Link>
      </p>
    </div>
  );
}
```

`pages/page.module.css` — додати:

```css
.switch {
  margin: 0;
  color: var(--graphite);
}
```

Видалити `features/api-key/` і `features/session/` повністю. `rg -n "features/(api-key|session)|apiKey'|TEST_API_KEY|API_KEY_STORAGE_KEY|x-api-key" apps/web/src` після кроку 9 має бути порожнім (крім прикладу `curl` у задачі 12, якого ще немає).

- [ ] **Step 9: тестова сесія і міграція тестів**

`test/fixtures.ts` повністю:

```ts
export const TEST_EMAIL = 'dev@example.com';
export const TEST_PASSWORD = 'correct horse battery';

export const TEST_ME = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'dev',
  email: TEST_EMAIL,
  createdAt: '2026-10-01T10:00:00.000Z',
  authMethod: 'session',
} as const;
```

`test/session.ts`:

```ts
let signedIn = false;

/** The session cookie the MSW gateway would hold; reset after every test. */
export const testSession = {
  signIn: () => {
    signedIn = true;
  },
  signOut: () => {
    signedIn = false;
  },
  isSignedIn: () => signedIn,
};
```

`test/server.ts` повністю:

```ts
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { TEST_EMAIL, TEST_ME, TEST_PASSWORD } from './fixtures';
import { testSession } from './session';

export const STORAGE_ORIGIN = 'http://storage.test';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const unauthorized = (message: string) =>
  HttpResponse.json({ statusCode: 401, message }, { status: 401 });

/**
 * Each test declares the handlers it relies on; unknown requests fail the test. Shared ones:
 * the runtime config (Grafana off by default) and the session — `/v1/me` answers while
 * `testSession` is signed in, which sign-in with the test credentials and sign-out switch.
 */
export const server = setupServer(
  http.get('/config.json', () => HttpResponse.json({ grafanaUrl: null })),
  http.get('/v1/me', () =>
    testSession.isSignedIn() ? HttpResponse.json(TEST_ME) : unauthorized('unauthorized'),
  ),
  http.post('/v1/auth/login', async ({ request }) => {
    const body: unknown = await request.json();
    if (!isRecord(body) || body.email !== TEST_EMAIL || body.password !== TEST_PASSWORD) {
      return unauthorized('invalid email or password');
    }
    testSession.signIn();
    const { id, name, email, createdAt } = TEST_ME;
    return HttpResponse.json({ id, name, email, createdAt });
  }),
  http.post('/v1/auth/logout', () => {
    testSession.signOut();
    return new HttpResponse(null, { status: 204 });
  }),
);
```

`test/setup.ts`, в `afterEach` після `server.resetHandlers()`: `testSession.signOut();` (імпорт з `./session`).

`test/render-app.tsx`:

```tsx
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { initI18n } from '../app/i18n';
import { Providers } from '../app/Providers';
import { routes } from '../app/router';
import { createStore } from '../app/store';
import { testSession } from './session';

export function renderApp({
  signedIn = false,
  route = '/jobs',
}: { signedIn?: boolean; route?: string } = {}) {
  if (signedIn) testSession.signIn();
  const store = createStore();
  const router = createMemoryRouter(routes, { initialEntries: [route] });
  const user = userEvent.setup();
  const view = render(
    <Providers store={store} i18n={initI18n('en')}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, store, user, router };
}
```

Механічна міграція решти тестів:

```bash
cd apps/web/src
rg -l "TEST_API_KEY" | xargs sed -i '' \
  -e 's/apiKey: TEST_API_KEY/signedIn: true/g' \
  -e 's/import { renderApp, TEST_API_KEY } from/import { renderApp } from/' \
  -e "/import { TEST_API_KEY } from '..\/test\/fixtures';/d"
rg -l "'Account: dev'" | xargs sed -i '' "s/'Account: dev'/'Account: dev@example.com'/g"
rg -n "TEST_API_KEY|API key|apiKey" --glob '*.test.*' .
```

Останній `rg` покаже залишки — їх виправити вручну за змістом (нижче — для двох файлів, де змінюється поведінка).

`app/upload-dialog.test.tsx`, тест `'stops and forgets the uploads of a user who signs out'` — повторний вхід:

```tsx
await user.click(screen.getByRole('button', { name: 'Account: dev@example.com' }));
await user.click(screen.getByRole('button', { name: 'Sign out' }));
await user.type(await screen.findByLabelText('Email'), TEST_EMAIL);
await user.type(screen.getByLabelText('Password'), TEST_PASSWORD);
releaseStorage();
await user.click(screen.getByRole('button', { name: 'Sign in' }));
await user.click(await screen.findByRole('link', { name: 'Jobs' }));
```

(імпорт `TEST_EMAIL`, `TEST_PASSWORD` з `../test/fixtures`.)

`app/auth-flow.test.tsx`: блок «signing in» переписати повністю (решту блоків — меню, мова, 404, назви сторінок — лишити, лише прибрати локальні `signedIn`-змінні на користь `testSession` і `renderApp({ signedIn: true })`):

```tsx
async function signIn(user: ReturnType<typeof renderApp>['user'], password = TEST_PASSWORD) {
  await user.type(await screen.findByLabelText('Email'), TEST_EMAIL);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('signing in', () => {
  it('sends a visitor to sign in and back to the page they asked for', async () => {
    server.use(http.get('/v1/webhooks', () => HttpResponse.json({ items: [] })));
    const { user, router } = renderApp({ route: '/webhooks?x=1' });

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    await signIn(user);

    await waitFor(() => expect(router.state.location.pathname).toBe('/webhooks'));
    expect(router.state.location.search).toBe('?x=1');
  });

  it('ignores a return address that leaves the app', async () => {
    server.use(http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })));
    const { user, router } = renderApp({ route: '/login?next=https://evil.example' });
    await signIn(user);
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
  });

  it('skips the form for someone already signed in', async () => {
    server.use(http.get('/v1/jobs', () => HttpResponse.json({ items: [], nextCursor: null })));
    const { router } = renderApp({ signedIn: true, route: '/login?next=/jobs' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'));
  });

  it('says so when the password is wrong, and clears it', async () => {
    const { user } = renderApp({ route: '/login' });
    await signIn(user, 'not the password');

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveValue('');
    expect(password).toHaveFocus();
  });

  it('checks the fields before asking the server', async () => {
    let attempts = 0;
    server.use(
      http.post('/v1/auth/login', () => {
        attempts += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    const { user } = renderApp({ route: '/login' });
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Enter your email.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(attempts).toBe(0);
  });

  it('counts down when there were too many attempts', async () => {
    server.use(
      http.post(
        '/v1/auth/login',
        () => new HttpResponse(null, { status: 429, headers: { 'Retry-After': '30' } }),
      ),
    );
    const { user } = renderApp({ route: '/login' });
    await signIn(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 30 seconds.',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('says the server could not be reached', async () => {
    server.use(http.post('/v1/auth/login', () => HttpResponse.error()));
    const { user } = renderApp({ route: '/login' });
    await signIn(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server. Try again.',
    );
  });

  it('sends someone whose session ended back to sign in', async () => {
    server.use(
      http.get('/v1/jobs', () => {
        testSession.signOut();
        return new HttpResponse(null, { status: 401 });
      }),
    );
    const { router } = renderApp({ signedIn: true, route: '/jobs' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Fjobs');
  });

  it('forgets the API key an older version kept in the browser', async () => {
    window.localStorage.setItem('pdp.apiKey', 'pdp_old');
    renderApp({ route: '/login' });
    await waitFor(() => expect(window.localStorage.getItem('pdp.apiKey')).toBeNull());
  });
});
```

Збережіть наявні тести «explains when the sign-in check itself fails» (і на `/jobs`, і на `/login`) — замініть у них лише спосіб входу. Тест виходу через меню тепер спирається на обробник за замовчуванням: після `Sign out` перевірити `/login` і `expect(await screen.findByLabelText('Email')).toBeInTheDocument()`.

Тест з `/library` (`ignores a return address…`) торкається заглушки `LibraryPage`, яка поки не робить запитів, — обробник `/v1/assets` знадобиться після задачі 7; лишіть його вже зараз.

- [ ] **Step 10: перевірка й коміт**

Run: `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test:web` → PASS.
Run (стабільність): 4 паралельні прогони `src/app/auth-flow.test.tsx src/app/upload-dialog.test.tsx` з `CI=true` (команда — у глобальних обмеженнях) → усі `0`.
Run: `rg -n "features/(api-key|session)|TEST_API_KEY|x-api-key" apps/web/src` → порожньо.

```bash
git add -A apps/web/src
git commit -m "feat(stage-5c.4): sign in with email and password instead of an API key

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 6: реєстрація

**Files:**

- Create: `apps/web/src/features/auth/ui/RegisterForm.tsx`
- Modify: `apps/web/src/features/auth/index.ts`
- Modify: `apps/web/src/pages/register/RegisterPage.tsx`
- Modify: `apps/web/src/locales/{en,uk}/shell.json` (`registerPage` лишає тільки `title`)
- Test: `apps/web/src/pages/register/RegisterPage.test.tsx`

**Interfaces:**

```ts
export function RegisterForm(props: { loginHref: string }): JSX.Element;
// loginHref — куди веде посилання «Увійти» при 409 (зберігає next)
```

- [ ] **Step 1: падаючі тести**

`apps/web/src/pages/register/RegisterPage.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TEST_ME } from '../../test/fixtures';
import { renderApp } from '../../test/render-app';
import { server } from '../../test/server';
import { testSession } from '../../test/session';

const NEW_EMAIL = 'new@example.com';

function registerHandler(onBody: (body: unknown) => void = () => undefined) {
  server.use(
    http.post('/v1/auth/register', async ({ request }) => {
      const body: unknown = await request.json();
      onBody(body);
      if (
        typeof body === 'object' &&
        body !== null &&
        'email' in body &&
        body.email === 'taken@example.com'
      ) {
        return HttpResponse.json(
          { statusCode: 409, code: 'EMAIL_TAKEN', message: 'email is already registered' },
          { status: 409 },
        );
      }
      testSession.signIn();
      return HttpResponse.json({ ...TEST_ME, email: NEW_EMAIL }, { status: 201 });
    }),
    http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })),
  );
}

async function fill(user: ReturnType<typeof renderApp>['user'], email: string, password: string) {
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
}

describe('creating an account', () => {
  it('creates the account and opens the library', async () => {
    let sent: unknown;
    registerHandler((body) => {
      sent = body;
    });
    const { user, router } = renderApp({ route: '/register' });
    await user.type(await screen.findByLabelText('Name'), '  Ann  ');
    await fill(user, NEW_EMAIL, 'long enough');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    expect(sent).toEqual({ name: 'Ann', email: NEW_EMAIL, password: 'long enough' });
  });

  it('leaves the name out when it is empty', async () => {
    let sent: unknown;
    registerHandler((body) => {
      sent = body;
    });
    const { user } = renderApp({ route: '/register' });
    await fill(user, NEW_EMAIL, 'long enough');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(sent).toEqual({ email: NEW_EMAIL, password: 'long enough' }));
  });

  it('points to sign-in when the email is taken, keeping the return address', async () => {
    registerHandler();
    const { user } = renderApp({ route: '/register?next=%2Fjobs' });
    await fill(user, 'taken@example.com', 'long enough');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('This email is already registered.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('link', { name: 'Sign in instead' })).toHaveAttribute(
      'href',
      '/login?next=%2Fjobs',
    );
  });

  it('wants a password of at least 8 characters', async () => {
    registerHandler();
    const { user } = renderApp({ route: '/register' });
    await fill(user, NEW_EMAIL, 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });
});
```

`getByLabelText('Password')` знаходить поле за текстом `<label>`; підказка «At least 8 characters.» підключена через `aria-describedby`, тож не заважає.

Run: `cd apps/web && pnpm vitest run src/pages/register` → FAIL.

- [ ] **Step 2: `RegisterForm`**

`features/auth/ui/RegisterForm.tsx`:

```tsx
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCountdown } from '../../../shared/lib/use-countdown';
import { Button } from '../../../shared/ui/button/Button';
import { Field } from '../../../shared/ui/field/Field';
import { Input } from '../../../shared/ui/field/Input';
import { useRegisterMutation } from '../api/auth-api';
import { type AuthFailure, authFailureOf } from '../model/auth-failure';
import {
  emailProblem,
  type FieldProblem,
  NAME_MAX_LENGTH,
  nameProblem,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
} from '../model/validate';
import styles from './AuthForm.module.css';
import { FormFailure } from './FormFailure';

type Problems = {
  name: FieldProblem | null;
  email: FieldProblem | null;
  password: FieldProblem | null;
};
const NO_PROBLEMS: Problems = { name: null, email: null, password: null };

export function RegisterForm({ loginHref }: { loginHref: string }) {
  const { t } = useTranslation('auth');
  const [register, { isLoading }] = useRegisterMutation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [secondsLeft, startCountdown] = useCountdown();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = {
      name: nameProblem(name),
      email: emailProblem(email),
      password: passwordProblem(password, { isNew: true }),
    };
    setProblems(found);
    if (found.name) {
      nameRef.current?.focus();
      return;
    }
    if (found.email) {
      emailRef.current?.focus();
      return;
    }
    if (found.password) {
      passwordRef.current?.focus();
      return;
    }

    setFailure(null);
    const trimmedName = name.trim();
    try {
      await register({
        ...(trimmedName && { name: trimmedName }),
        email: email.trim(),
        password,
      }).unwrap();
    } catch (error) {
      const next = authFailureOf(error);
      setFailure(next);
      if (next.kind === 'retryLater') startCountdown(next.retryAfterS);
      if (next.kind === 'emailTaken') emailRef.current?.focus();
    }
  };

  const emailError =
    failure?.kind === 'emailTaken' ? (
      <>
        {t('failure.emailTaken')} <Link to={loginHref}>{t('failure.emailTakenAction')}</Link>
      </>
    ) : problems.email ? (
      t(`problem.email.${problems.email}`)
    ) : undefined;

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void handleSubmit(event)}>
      <Field
        label={t('name')}
        hint={t('nameHint')}
        error={
          problems.name ? t(`problem.name.${problems.name}`, { count: NAME_MAX_LENGTH }) : undefined
        }
      >
        {(control) => (
          <Input
            {...control}
            ref={nameRef}
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field label={t('email')} error={emailError}>
        {(control) => (
          <Input
            {...control}
            ref={emailRef}
            type="email"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </Field>
      <Field
        label={t('password')}
        hint={t('newPasswordHint', { count: PASSWORD_MIN_LENGTH })}
        error={
          problems.password
            ? t(`problem.password.${problems.password}`, {
                count: problems.password === 'tooLong' ? PASSWORD_MAX_LENGTH : PASSWORD_MIN_LENGTH,
              })
            : undefined
        }
      >
        {(control) => (
          <Input
            {...control}
            ref={passwordRef}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
      <FormFailure failure={failure} secondsLeft={secondsLeft} />
      <Button
        variant="primary"
        type="submit"
        className={styles.submit}
        isBusy={isLoading}
        disabled={secondsLeft > 0}
      >
        {t('register.submit')}
      </Button>
    </form>
  );
}
```

Експорт у `features/auth/index.ts`: `export { RegisterForm } from './ui/RegisterForm';`.

- [ ] **Step 3: сторінка**

`pages/register/RegisterPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router';
import { RegisterForm, useGetMeQuery } from '../../features/auth';
import { safeReturnTo } from '../../shared/lib/return-to';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import styles from '../page.module.css';

export function RegisterPage() {
  const { t } = useTranslation('shell');
  const { t: tAuth } = useTranslation('auth');
  const [params] = useSearchParams();
  const me = useGetMeQuery();
  const next = params.get('next');
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  if (me.data) return <Navigate to={safeReturnTo(next)} replace />;

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeading>{t('registerPage.title')}</PageHeading>
      {me.isLoading ? (
        <Skeleton height="22rem" radius="mount" />
      ) : (
        <RegisterForm loginHref={loginHref} />
      )}
      <p className={styles.switch}>
        {tAuth('register.haveAccount')} <Link to={loginHref}>{tAuth('register.toLogin')}</Link>
      </p>
    </div>
  );
}
```

`shell.json` (en/uk): `registerPage` → лише `title`.

Run: `cd apps/web && pnpm vitest run src/pages/register` → PASS. Run: `pnpm typecheck && pnpm lint && pnpm test:web` → PASS.

- [ ] **Step 4: коміт**

```bash
git add -A apps/web/src
git commit -m "feat(stage-5c.4): create an account from the web app

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 7: фіча `assets` і медіатека — фільтри в URL, сітка, стани

**Files:**

- Modify: `apps/web/src/shared/api/base-api.ts` (тег `Asset`)
- Create: `apps/web/src/shared/lib/format-duration.ts`, `format-duration.test.ts`
- Modify: `apps/web/src/features/jobs/model/status-labels.ts`, `features/jobs/index.ts` (`STATUS_TONE`)
- Create: `apps/web/src/features/assets/index.ts`, `model/types.ts`, `api/assets-api.ts`
- Create: `apps/web/src/locales/en/assets.json`, `apps/web/src/locales/uk/assets.json`
- Modify: `apps/web/src/app/i18n.ts`, `locales/{en,uk}/shell.json` (видалити `library.*`)
- Create: `apps/web/src/pages/library/lib/use-library-params.ts`
- Create: `apps/web/src/pages/library/ui/LibraryFilters.tsx`, `LibraryFilters.module.css`, `AssetTile.tsx`, `AssetTile.module.css`
- Modify: `apps/web/src/pages/library/LibraryPage.tsx`; Create: `LibraryPage.module.css`
- Modify: `apps/web/src/test/fixtures.ts` (`testAsset`)
- Test: `apps/web/src/pages/library/LibraryPage.test.tsx`

**Interfaces:**

```ts
// features/assets
export const ASSET_KINDS: readonly ['image', 'video'];
export type AssetKind = 'image' | 'video';
export const ASSET_STATUSES: readonly ['processing', 'ready', 'failed'];
export type AssetStatus = 'processing' | 'ready' | 'failed';
export const ASSET_SEARCH_MAX_LENGTH = 100;
export type AssetJobStatus = 'queued' | 'scheduled' | 'running' | 'succeeded' | 'failed' | 'dead';
export type Asset = {
  id;
  kind;
  name: string | null;
  contentType;
  size: number | null;
  width;
  height;
  durationSeconds;
  sourceKey;
  createdAt;
};
export type AssetSummary = Asset & {
  preview: { url; width; height } | null;
  latestJob: { id; type; status: AssetJobStatus } | null;
};
export type AssetPage = { items: AssetSummary[]; nextCursor: string | null };
export type AssetFilters = { kind: AssetKind | null; status: AssetStatus | null; q: string };
export const ASSETS_PAGE_SIZE = 24;
export function isActiveJobStatus(status: AssetJobStatus): boolean;
export const assetsApi;
export const useListAssetsInfiniteQuery;

// features/jobs
export const STATUS_TONE: Record<JobStatus, Tone>;

// shared/lib/format-duration.ts
export function formatDuration(totalSeconds: number): string; // 0:12, 1:05, 1:02:05

// pages/library/lib/use-library-params.ts
export type FilterPatch = Partial<AssetFilters>;
export function useLibraryParams(): readonly [
  AssetFilters,
  (patch: FilterPatch, options?: { replace?: boolean }) => void,
];
```

- [ ] **Step 1: `formatDuration` (TDD)**

`shared/lib/format-duration.test.ts`:

```ts
import { formatDuration } from './format-duration';

describe('formatDuration', () => {
  it('shows minutes and seconds, and hours only when there are some', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(12.4)).toBe('0:12');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
```

Run → FAIL. `shared/lib/format-duration.ts`:

```ts
const pad = (value: number) => String(value).padStart(2, '0');

/** `m:ss`, or `h:mm:ss` from an hour up, like video players show it. */
export function formatDuration(totalSeconds: number): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
```

Run → PASS.

- [ ] **Step 2: `STATUS_TONE`, тег `Asset`, фіча `assets`**

`features/jobs/model/status-labels.ts` — додати (імпорт `type Tone` з `../../../shared/ui/tone`, `type JobStatus` з `./types`, якщо ще немає):

```ts
export const STATUS_TONE = {
  queued: 'neutral',
  scheduled: 'neutral',
  running: 'progress',
  succeeded: 'success',
  failed: 'danger',
  dead: 'danger',
} as const satisfies Record<JobStatus, Tone>;
```

і експорт у `features/jobs/index.ts`: `export { STATUS_LABEL_KEY, STATUS_TONE } from './model/status-labels';`.

`shared/api/base-api.ts`: `tagTypes: ['Job', 'Webhook', 'Me', 'Asset']`.

`features/assets/model/types.ts`:

```ts
export const ASSET_KINDS = ['image', 'video'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** What the latest job says about a file; the gateway filters by it. */
export const ASSET_STATUSES = ['processing', 'ready', 'failed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Mirrors `ASSET_SEARCH_MAX_LENGTH` in @pdp/contracts. */
export const ASSET_SEARCH_MAX_LENGTH = 100;

export type AssetJobStatus = 'queued' | 'scheduled' | 'running' | 'succeeded' | 'failed' | 'dead';

const ACTIVE: readonly AssetJobStatus[] = ['queued', 'scheduled', 'running'];
export const isActiveJobStatus = (status: AssetJobStatus): boolean => ACTIVE.includes(status);

export type Asset = {
  id: string;
  kind: AssetKind;
  name: string | null;
  contentType: string;
  size: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  sourceKey: string;
  createdAt: string;
};

export type AssetSummary = Asset & {
  preview: { url: string; width: number; height: number } | null;
  latestJob: { id: string; type: string; status: AssetJobStatus } | null;
};

export type AssetPage = { items: AssetSummary[]; nextCursor: string | null };

export type AssetFilters = { kind: AssetKind | null; status: AssetStatus | null; q: string };
```

`features/assets/api/assets-api.ts`:

```ts
import { baseApi } from '../../../shared/api/base-api';
import { type AssetFilters, type AssetPage } from '../model/types';

export const ASSETS_PAGE_SIZE = 24;
/** Tag of every list page; a file's own page is tagged with its id. */
export const ASSET_LIST_TAG = { type: 'Asset', id: 'LIST' } as const;

function paramsOf({ kind, status, q }: AssetFilters, cursor: string) {
  const query = q.trim();
  return {
    limit: ASSETS_PAGE_SIZE,
    ...(kind && { kind }),
    ...(status && { status }),
    ...(query && { q: query }),
    ...(cursor && { cursor }),
  };
}

export const assetsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listAssets: build.infiniteQuery<AssetPage, AssetFilters, string>({
      infiniteQueryOptions: {
        initialPageParam: '',
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
      query: ({ queryArg, pageParam }) => ({
        url: '/v1/assets',
        params: paramsOf(queryArg, pageParam),
      }),
      providesTags: [ASSET_LIST_TAG],
    }),
  }),
});

export const { useListAssetsInfiniteQuery } = assetsApi;
```

(Якщо `build.infiniteQuery` у RTK 2.13 не приймає `providesTags` масивом — використайте `providesTags: () => [ASSET_LIST_TAG]`.)

`features/assets/index.ts`:

```ts
export {
  ASSET_LIST_TAG,
  ASSETS_PAGE_SIZE,
  assetsApi,
  useListAssetsInfiniteQuery,
} from './api/assets-api';
export {
  ASSET_KINDS,
  ASSET_SEARCH_MAX_LENGTH,
  ASSET_STATUSES,
  type Asset,
  type AssetFilters,
  type AssetJobStatus,
  type AssetKind,
  type AssetPage,
  type AssetStatus,
  type AssetSummary,
  isActiveJobStatus,
} from './model/types';
```

- [ ] **Step 3: тексти `assets`**

`locales/en/assets.json`:

```json
{
  "library": {
    "title": "Library",
    "kind": { "legend": "Type", "all": "All", "image": "Photos", "video": "Videos" },
    "status": {
      "label": "Status",
      "any": "Any status",
      "processing": "Processing",
      "ready": "Ready",
      "failed": "Failed"
    },
    "search": "Search by name",
    "loading": "Loading files…",
    "errorTitle": "Could not load the library",
    "error": "The gateway did not answer. Try again in a moment.",
    "tooManyRequests_one": "Too many requests. Try again in {{count}} second.",
    "tooManyRequests_other": "Too many requests. Try again in {{count}} seconds.",
    "emptyTitle": "Your files will live here",
    "emptyBody": "Upload a photo or a video: it lands here together with every processed version.",
    "upload": "Upload a file",
    "noMatchesTitle": "Nothing found",
    "noMatchesBody": "No file matches these filters.",
    "resetFilters": "Reset filters"
  },
  "tile": {
    "untitled": "Untitled file",
    "video": "Video",
    "videoWithDuration": "Video · {{duration}}"
  }
}
```

`locales/uk/assets.json`:

```json
{
  "library": {
    "title": "Медіатека",
    "kind": { "legend": "Тип", "all": "Усі", "image": "Фото", "video": "Відео" },
    "status": {
      "label": "Статус",
      "any": "Будь-який статус",
      "processing": "Обробляється",
      "ready": "Готово",
      "failed": "Помилка"
    },
    "search": "Пошук за назвою",
    "loading": "Завантажуємо файли…",
    "errorTitle": "Не вдалося завантажити медіатеку",
    "error": "Gateway не відповів. Спробуйте за хвилину.",
    "tooManyRequests_one": "Забагато запитів. Спробуйте через {{count}} секунду.",
    "tooManyRequests_few": "Забагато запитів. Спробуйте через {{count}} секунди.",
    "tooManyRequests_many": "Забагато запитів. Спробуйте через {{count}} секунд.",
    "tooManyRequests_other": "Забагато запитів. Спробуйте через {{count}} секунди.",
    "emptyTitle": "Тут з'являться ваші файли",
    "emptyBody": "Завантажте фото чи відео: воно з'явиться тут разом з усіма обробленими версіями.",
    "upload": "Завантажити файл",
    "noMatchesTitle": "Нічого не знайдено",
    "noMatchesBody": "Жоден файл не відповідає цим фільтрам.",
    "resetFilters": "Скинути фільтри"
  },
  "tile": {
    "untitled": "Файл без назви",
    "video": "Відео",
    "videoWithDuration": "Відео · {{duration}}"
  }
}
```

(Український набір множин може відрізнятися від англійського — `app/i18n.test.ts` порівнює ключі без суфіксів множини.)

`app/i18n.ts`: додати простір `assets` (імпорти en/uk, `resources`, `ns`). `shell.json` (en/uk): видалити блок `library` — `nav.library` лишається.

- [ ] **Step 4: падаючі тести медіатеки**

`test/fixtures.ts` — додати:

```ts
import { type Asset, type AssetSummary } from '../features/assets';

export const TEST_ASSET: Asset = {
  id: 'a0000000-0000-4000-8000-000000000001',
  kind: 'image',
  name: 'harbour.jpg',
  contentType: 'image/jpeg',
  size: 2_400_000,
  width: 1200,
  height: 800,
  durationSeconds: null,
  sourceKey: 'u/1/harbour',
  createdAt: '2026-10-14T10:00:00.000Z',
};

export const testAsset = (overrides: Partial<AssetSummary> = {}): AssetSummary => ({
  ...TEST_ASSET,
  preview: { url: 'http://storage.test/thumb.webp', width: 200, height: 133 },
  latestJob: {
    id: 'b0000000-0000-4000-8000-000000000001',
    type: 'image.resize',
    status: 'succeeded',
  },
  ...overrides,
});
```

`pages/library/LibraryPage.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type AssetSummary } from '../../features/assets';
import { formatBytes } from '../../shared/lib/format-bytes';
import { testAsset } from '../../test/fixtures';
import { renderApp } from '../../test/render-app';
import { server } from '../../test/server';

const VIDEO = testAsset({
  id: 'a0000000-0000-4000-8000-000000000002',
  kind: 'video',
  name: 'cliffs.mp4',
  contentType: 'video/mp4',
  durationSeconds: 12,
  preview: null,
  latestJob: { id: 'b0000000-0000-4000-8000-000000000002', type: 'video.frames', status: 'queued' },
});

/** Answers every list request with `items` and records what was asked. */
function listAssets(items: AssetSummary[] = []) {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get('/v1/assets', ({ request }) => {
      requests.push(new URL(request.url).searchParams);
      return HttpResponse.json({ items, nextCursor: null });
    }),
  );
  return requests;
}

describe('library', () => {
  it('shows each file with its preview, status and size', async () => {
    listAssets([testAsset(), VIDEO]);
    renderApp({ signedIn: true, route: '/library' });

    const photo = await screen.findByRole('link', { name: /harbour\.jpg/ });
    expect(photo).toHaveAttribute('href', '/library/a0000000-0000-4000-8000-000000000001');
    const photoTile = photo.closest('li');
    expect(photoTile).not.toBeNull();
    if (!photoTile) return;
    expect(within(photoTile).getByText('Done')).toBeInTheDocument();
    expect(within(photoTile).getByText(formatBytes(2_400_000, 'en'))).toBeInTheDocument();

    const video = screen.getByRole('link', { name: /cliffs\.mp4/ });
    expect(video).toHaveTextContent('Video · 0:12');
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('keeps the filters in the address and asks the gateway for them', async () => {
    const requests = listAssets();
    const { user, router } = renderApp({ signedIn: true, route: '/library' });

    await user.click(await screen.findByRole('radio', { name: 'Videos' }));
    await waitFor(() => expect(requests.at(-1)?.get('kind')).toBe('video'));
    expect(router.state.location.search).toBe('?kind=video');
    expect(router.state.historyAction).toBe('PUSH');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Failed');
    await waitFor(() => expect(requests.at(-1)?.get('status')).toBe('failed'));

    await user.type(screen.getByRole('searchbox', { name: 'Search by name' }), 'harb');
    await waitFor(() => expect(requests.at(-1)?.get('q')).toBe('harb'));
    expect(router.state.location.search).toBe('?kind=video&status=failed&q=harb');
    expect(router.state.historyAction).toBe('REPLACE');
    // One request for the whole word, not one per key.
    expect(requests.filter((r) => r.has('q'))).toHaveLength(1);
  });

  it('ignores filter values it does not know', async () => {
    const requests = listAssets();
    renderApp({ signedIn: true, route: '/library?kind=audio&status=done&q=sea' });

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.has('kind')).toBe(false);
    expect(requests[0]?.has('status')).toBe(false);
    expect(requests[0]?.get('q')).toBe('sea');
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
  });

  it('invites the first upload when the library is empty', async () => {
    listAssets();
    const { user } = renderApp({ signedIn: true, route: '/library' });

    expect(
      await screen.findByRole('heading', { name: 'Your files will live here' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upload a file' }));
    expect(screen.getByRole('dialog', { name: 'Upload files' })).toHaveAttribute('open');
  });

  it('offers to reset filters that match nothing', async () => {
    listAssets();
    const { user, router } = renderApp({ signedIn: true, route: '/library?kind=video&q=sea' });

    expect(await screen.findByRole('heading', { name: 'Nothing found' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));

    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByRole('searchbox', { name: 'Search by name' })).toHaveValue('');
  });

  it('shows a skeleton first, and a way back from an error', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.get('/v1/assets', async () => {
        calls += 1;
        if (calls === 1) {
          await held;
          return HttpResponse.json({ message: 'down' }, { status: 500 });
        }
        return HttpResponse.json({ items: [testAsset()], nextCursor: null });
      }),
    );
    const { user } = renderApp({ signedIn: true, route: '/library' });

    expect(await screen.findByRole('status', { name: 'Loading files…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    release();
    expect(
      await screen.findByRole('heading', { name: 'Could not load the library' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /harbour\.jpg/ })).toBeInTheDocument();
  });
});
```

(`ErrorState` за замовчуванням має кнопку з `retry.label`; `'Try again'` — з `shell.retry`. Якщо RTK Query повторює `500` автоматично (`retry` не налаштований — не повторює), лічильник `calls` це покаже.)

Run: `cd apps/web && pnpm vitest run src/pages/library` → FAIL.

- [ ] **Step 5: параметри в URL**

`pages/library/lib/use-library-params.ts`:

```ts
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { ASSET_KINDS, ASSET_STATUSES, type AssetFilters } from '../../../features/assets';

export type FilterPatch = Partial<AssetFilters>;
export type SetFilters = (patch: FilterPatch, options?: { replace?: boolean }) => void;

/** Filters live in the URL, so they survive a reload and the back button; unknown values are ignored. */
export function useLibraryParams(): readonly [AssetFilters, SetFilters] {
  const [params, setParams] = useSearchParams();
  const kindParam = params.get('kind');
  const statusParam = params.get('status');
  const q = params.get('q') ?? '';

  const filters = useMemo<AssetFilters>(
    () => ({
      kind: ASSET_KINDS.find((kind) => kind === kindParam) ?? null,
      status: ASSET_STATUSES.find((status) => status === statusParam) ?? null,
      q,
    }),
    [kindParam, statusParam, q],
  );

  const setFilters = useCallback<SetFilters>(
    (patch, { replace = false } = {}) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace },
      ),
    [setParams],
  );

  return [filters, setFilters] as const;
}
```

- [ ] **Step 6: фільтри**

`pages/library/ui/LibraryFilters.tsx`:

```tsx
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ASSET_SEARCH_MAX_LENGTH,
  ASSET_STATUSES,
  type AssetFilters,
} from '../../../features/assets';
import { ChoiceGroup } from '../../../shared/ui/choice/ChoiceGroup';
import { Radio } from '../../../shared/ui/choice/Radio';
import { Field } from '../../../shared/ui/field/Field';
import { Input } from '../../../shared/ui/field/Input';
import { Select } from '../../../shared/ui/select/Select';
import { type SetFilters } from '../lib/use-library-params';
import styles from './LibraryFilters.module.css';

const SEARCH_DEBOUNCE_MS = 300;
const KIND_OPTIONS = [null, 'image', 'video'] as const;

type LibraryFiltersProps = { filters: AssetFilters; onChange: SetFilters };

export function LibraryFilters({ filters, onChange }: LibraryFiltersProps) {
  const { t } = useTranslation('assets');
  const kindName = useId();
  const [draft, setDraft] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  // The URL changed from outside (reset, back button): show what it says now.
  if (filters.q !== seenQ) {
    setSeenQ(filters.q);
    if (filters.q !== draft.trim()) setDraft(filters.q);
  }

  useEffect(() => {
    const q = draft.trim();
    if (q === filters.q) return;
    const timer = setTimeout(() => onChange({ q }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, filters.q, onChange]);

  return (
    <div className={styles.filters}>
      <ChoiceGroup legend={t('library.kind.legend')} className={styles.kinds}>
        {KIND_OPTIONS.map((kind) => (
          <Radio
            key={kind ?? 'all'}
            name={kindName}
            className={styles.segment}
            label={t(`library.kind.${kind ?? 'all'}`)}
            checked={filters.kind === kind}
            onChange={() => onChange({ kind })}
          />
        ))}
      </ChoiceGroup>
      <Field label={t('library.status.label')} className={styles.status}>
        {(control) => (
          <Select
            {...control}
            value={filters.status ?? ''}
            onChange={(event) =>
              onChange({ status: ASSET_STATUSES.find((s) => s === event.target.value) ?? null })
            }
          >
            <option value="">{t('library.status.any')}</option>
            {ASSET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`library.status.${status}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('library.search')} className={styles.search}>
        {(control) => (
          <Input
            {...control}
            type="search"
            maxLength={ASSET_SEARCH_MAX_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        )}
      </Field>
    </div>
  );
}
```

`LibraryFilters.module.css`:

```css
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-4);
}

/* The fieldset is a flex column by default; the legend is not a flex item, so it stays on top. */
.kinds {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* Radios in a row read as one segmented control; the dot stays for clarity. */
.segment {
  padding: 0 var(--space-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-control);
}

.segment:has(input:checked) {
  border-color: var(--ink);
  font-weight: var(--weight-semibold);
}

.status {
  min-width: 12rem;
}

.search {
  flex: 1 1 16rem;
}
```

`ChoiceGroup` — це `<fieldset>` з `display: flex; flex-direction: column` (`Choice.module.css`), `Radio` — `<label>` з `className`; токени `--rule`, `--ink`, `--weight-semibold` звірте з `tokens.css`. Вигляд сегментів перевіряється в браузері в задачі 13.

- [ ] **Step 7: плитка**

`pages/library/ui/AssetTile.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { type AssetSummary } from '../../../features/assets';
import { STATUS_LABEL_KEY, STATUS_TONE } from '../../../features/jobs';
import { formatBytes } from '../../../shared/lib/format-bytes';
import { formatDuration } from '../../../shared/lib/format-duration';
import { Badge } from '../../../shared/ui/badge/Badge';
import { Card } from '../../../shared/ui/card/Card';
import styles from './AssetTile.module.css';

/** Sent along to the file page, so its breadcrumb returns to the same filters. */
export type LibraryLinkState = { librarySearch: string };

type AssetTileProps = { asset: AssetSummary; linkState: LibraryLinkState };

export function AssetTile({ asset, linkState }: AssetTileProps) {
  const { t, i18n } = useTranslation('assets');
  const { t: tJobs } = useTranslation('jobs');
  const name = asset.name ?? t('tile.untitled');

  return (
    <Card className={styles.tile}>
      <Link to={`/library/${asset.id}`} state={linkState} className={styles.link}>
        <span className={styles.frame}>
          {asset.preview ? (
            <img
              className={styles.image}
              src={asset.preview.url}
              width={asset.preview.width}
              height={asset.preview.height}
              alt=""
              loading="lazy"
            />
          ) : (
            <span className={styles.placeholder} aria-hidden="true">
              {asset.kind === 'video' ? '▶' : '◻'}
            </span>
          )}
          {asset.kind === 'video' && (
            <span className={styles.kind}>
              {asset.durationSeconds === null
                ? t('tile.video')
                : t('tile.videoWithDuration', { duration: formatDuration(asset.durationSeconds) })}
            </span>
          )}
        </span>
        <span className={styles.name} title={name}>
          {name}
        </span>
      </Link>
      <span className={styles.meta}>
        {asset.latestJob && (
          <Badge tone={STATUS_TONE[asset.latestJob.status]}>
            {tJobs(STATUS_LABEL_KEY[asset.latestJob.status])}
          </Badge>
        )}
        {asset.size !== null && <span>{formatBytes(asset.size, i18n.language)}</span>}
      </span>
    </Card>
  );
}
```

`AssetTile.module.css`:

```css
.tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  height: 100%;
  padding: var(--space-2);
}

.link {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  color: inherit;
  text-decoration: none;
}

.link:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}

.frame {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--radius-control);
  background: var(--paper-deep);
}

.image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.placeholder {
  color: var(--graphite);
  font-size: var(--text-xl);
}

.kind {
  position: absolute;
  inset: auto var(--space-1) var(--space-1) auto;
  padding: 0 var(--space-1);
  border-radius: var(--radius-control);
  background: var(--ink);
  color: var(--paper);
  font-size: var(--text-sm);
}

.name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 600;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1);
  color: var(--graphite);
  font-size: var(--text-sm);
}
```

Імена токенів (`--focus-ring`, `--paper-deep`, `--ink`, `--paper`, `--text-xl`) звірте з `shared/ui/tokens.css`; де токена немає — візьміть найближчий наявний (наприклад, з `SlideMount` на `/jobs`), нових токенів не вводити. Контраст підпису `.kind` на фоні — щонайменше 4.5:1 (див. `tokens.test.ts`).

- [ ] **Step 8: сторінка**

`pages/library/LibraryPage.tsx`:

```tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { useListAssetsInfiniteQuery } from '../../features/assets';
import { useOpenUpload } from '../../features/upload';
import { retryAfterOf } from '../../shared/api/http';
import { Button } from '../../shared/ui/button/Button';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import { EmptyState } from '../../shared/ui/state/EmptyState';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import styles from './LibraryPage.module.css';
import { useLibraryParams } from './lib/use-library-params';
import { AssetTile } from './ui/AssetTile';
import { LibraryFilters } from './ui/LibraryFilters';

const SKELETON_TILES = 8;

export function LibraryPage() {
  const { t } = useTranslation('assets');
  const { t: tShell } = useTranslation('shell');
  const { search } = useLocation();
  const openUpload = useOpenUpload();
  const [filters, setFilters] = useLibraryParams();
  const isFiltered = filters.kind !== null || filters.status !== null || filters.q !== '';
  const assets = useListAssetsInfiniteQuery(filters);
  // `currentData`, not `data`: after a filter change the old results must not stand in for the new.
  const pages = assets.currentData?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
  const linkState = useMemo(() => ({ librarySearch: search }), [search]);

  const content = (() => {
    if (!pages) {
      if (assets.isError) {
        const retryAfterS = retryAfterOf(assets.error);
        return (
          <ErrorState
            title={t('library.errorTitle')}
            retry={{ label: tShell('retry'), onRetry: () => void assets.refetch() }}
          >
            <p>
              {retryAfterS === null
                ? t('library.error')
                : t('library.tooManyRequests', { count: retryAfterS })}
            </p>
          </ErrorState>
        );
      }
      return (
        <div
          role="status"
          aria-busy="true"
          aria-label={t('library.loading')}
          className={styles.grid}
        >
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <Skeleton key={index} height="14rem" radius="mount" />
          ))}
        </div>
      );
    }
    if (items.length === 0) {
      return isFiltered ? (
        <EmptyState
          title={t('library.noMatchesTitle')}
          action={
            <Button onClick={() => setFilters({ kind: null, status: null, q: '' })}>
              {t('library.resetFilters')}
            </Button>
          }
        >
          <p>{t('library.noMatchesBody')}</p>
        </EmptyState>
      ) : (
        <EmptyState
          title={t('library.emptyTitle')}
          action={
            <Button variant="primary" onClick={openUpload}>
              {t('library.upload')}
            </Button>
          }
        >
          <p>{t('library.emptyBody')}</p>
        </EmptyState>
      );
    }
    return (
      <ul className={styles.grid}>
        {items.map((asset) => (
          <li key={asset.id}>
            <AssetTile asset={asset} linkState={linkState} />
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <div className={styles.page}>
      <PageHeading>{t('library.title')}</PageHeading>
      <LibraryFilters filters={filters} onChange={setFilters} />
      {content}
    </div>
  );
}
```

(Якщо `EmptyState`/`ErrorState` приймають тіло інакше, ніж `children` — див. їх сигнатури в `shared/ui/state`; на `/jobs` є приклад використання.)

`LibraryPage.module.css`:

```css
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* Two columns on a 375 px phone, four or five on a laptop. */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (min-width: 48rem) {
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: var(--space-4);
  }
}
```

Run: `cd apps/web && pnpm vitest run src/pages/library src/shared/lib/format-duration.test.ts` → PASS.
Run: `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test:web` → PASS. Тест `auth-flow` «ignores a return address…» тепер ходить у `/v1/assets` — обробник там уже є з задачі 5.

- [ ] **Step 9: коміт**

```bash
git add -A apps/web/src
git commit -m "feat(stage-5c.4): browse the library with filters in the address

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 8: медіатека — нескінченна прокрутка

**Files:**

- Create: `apps/web/src/pages/library/ui/LoadMore.tsx`, `LoadMore.module.css`
- Modify: `apps/web/src/pages/library/LibraryPage.tsx`
- Modify: `apps/web/src/locales/{en,uk}/assets.json` (`library.more.*`)
- Create: `apps/web/src/test/intersection-observer.ts`
- Test: `apps/web/src/pages/library/LibraryPage.test.tsx`

**Interfaces:**

```ts
type LoadMoreProps = { isLoading: boolean; failed: boolean; onLoad: () => void };
export function LoadMore(props: LoadMoreProps): JSX.Element; // рендериться лише коли є наступна сторінка

// test/intersection-observer.ts
export class FakeIntersectionObserver implements IntersectionObserver {
  static latest(): FakeIntersectionObserver | undefined;
  reveal(): void; // викликає callback з isIntersecting: true
}
```

- [ ] **Step 1: фейковий `IntersectionObserver`**

`test/intersection-observer.ts`:

```ts
/** jsdom has no IntersectionObserver; tests reveal the observed element by hand. */
export class FakeIntersectionObserver implements IntersectionObserver {
  private static instances: FakeIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin: string;
  readonly scrollMargin = '0px';
  readonly thresholds: readonly number[] = [];
  private targets: Element[] = [];

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.rootMargin = options.rootMargin ?? '0px';
    FakeIntersectionObserver.instances.push(this);
  }

  static latest(): FakeIntersectionObserver | undefined {
    return FakeIntersectionObserver.instances.findLast((observer) => observer.targets.length > 0);
  }

  static reset(): void {
    FakeIntersectionObserver.instances = [];
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(target: Element): void {
    this.targets = this.targets.filter((t) => t !== target);
  }

  disconnect(): void {
    this.targets = [];
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  reveal(): void {
    const entries = this.targets.map((target) => {
      const rect = target.getBoundingClientRect();
      return {
        target,
        isIntersecting: true,
        intersectionRatio: 1,
        time: 0,
        boundingClientRect: rect,
        intersectionRect: rect,
        rootBounds: null,
      };
    });
    this.callback(entries, this);
  }
}
```

(Якщо `lib.dom` у вашій версії TypeScript не має `scrollMargin` в `IntersectionObserver` — властивість зайва, але не шкодить. Якщо `findLast` недоступний у `lib` — використайте `[...instances].reverse().find(...)`.)

- [ ] **Step 2: падаючі тести**

У `LibraryPage.test.tsx` додати імпорти `act` з `@testing-library/react`, `FakeIntersectionObserver` з `../../test/intersection-observer` і блок:

```tsx
describe('library pages', () => {
  beforeEach(() => vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver));
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeIntersectionObserver.reset();
  });

  const SECOND = testAsset({ id: 'a0000000-0000-4000-8000-000000000003', name: 'dunes.jpg' });

  function twoPages(
    nextPage: () => Response | Promise<Response> = () =>
      HttpResponse.json({ items: [SECOND], nextCursor: null }),
  ) {
    server.use(
      http.get('/v1/assets', ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === 'c1'
          ? nextPage()
          : HttpResponse.json({ items: [testAsset()], nextCursor: 'c1' }),
      ),
    );
  }

  it('loads the next page from the button and says how many files came', async () => {
    twoPages();
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));

    expect(await screen.findByRole('link', { name: /dunes\.jpg/ })).toBeInTheDocument();
    expect(screen.getByText('Added 1 more file.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('loads the next page when the end of the grid scrolls into view', async () => {
    twoPages();
    renderApp({ signedIn: true, route: '/library' });
    await screen.findByRole('button', { name: 'Show more' });

    act(() => FakeIntersectionObserver.latest()?.reveal());
    expect(await screen.findByRole('link', { name: /dunes\.jpg/ })).toBeInTheDocument();
  });

  it('keeps what it has when the next page fails, and tries again', async () => {
    let failed = false;
    twoPages(() => {
      if (failed) return HttpResponse.json({ items: [SECOND], nextCursor: null });
      failed = true;
      return HttpResponse.json({ message: 'down' }, { status: 500 });
    });
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));

    expect(await screen.findByText('Could not load more files.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /harbour\.jpg/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /dunes\.jpg/ })).toBeInTheDocument();
  });
});
```

Run → FAIL.

- [ ] **Step 3: тексти**

`assets.json` → `library.more`:

en:

```json
"more": {
  "label": "Show more",
  "failed": "Could not load more files.",
  "retry": "Try again",
  "added_one": "Added {{count}} more file.",
  "added_other": "Added {{count}} more files."
}
```

uk:

```json
"more": {
  "label": "Показати ще",
  "failed": "Не вдалося завантажити ще файли.",
  "retry": "Спробувати ще раз",
  "added_one": "Додано ще {{count}} файл.",
  "added_few": "Додано ще {{count}} файли.",
  "added_many": "Додано ще {{count}} файлів.",
  "added_other": "Додано ще {{count}} файлу."
}
```

- [ ] **Step 4: `LoadMore`**

`pages/library/ui/LoadMore.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/ui/button/Button';
import styles from './LoadMore.module.css';

/** Starts loading this far before the end of the grid scrolls into view. */
const PRELOAD_MARGIN = '600px';

type LoadMoreProps = { isLoading: boolean; failed: boolean; onLoad: () => void };

/**
 * The button is always there for keyboards, screen readers and browsers without
 * IntersectionObserver; scrolling near it loads the next page on its own.
 */
export function LoadMore({ isLoading, failed, onLoad }: LoadMoreProps) {
  const { t } = useTranslation('assets');
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || isLoading || failed || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoad();
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isLoading, failed, onLoad]);

  return (
    <div className={styles.more}>
      <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
      {failed && (
        <p role="alert" className={styles.failed}>
          {t('library.more.failed')}
        </p>
      )}
      <Button isBusy={isLoading} onClick={onLoad}>
        {failed ? t('library.more.retry') : t('library.more.label')}
      </Button>
    </div>
  );
}
```

`LoadMore.module.css`:

```css
.more {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.sentinel {
  width: 100%;
  height: 1px;
}

.failed {
  margin: 0;
  color: var(--graphite);
}
```

- [ ] **Step 5: сторінка — кнопка й оголошення**

У `LibraryPage.tsx`:

```tsx
import { useCallback, useMemo, useState } from 'react';
import { VisuallyHidden } from '../../shared/ui/visually-hidden/VisuallyHidden';
import { LoadMore } from './ui/LoadMore';
```

після `items`:

```tsx
const pageCount = pages?.length ?? 0;
const [announced, setAnnounced] = useState({ pageCount, message: '' });
// A new page arrived (polling refetches keep the count): say how many files it added.
if (pageCount !== announced.pageCount) {
  const added =
    pageCount > announced.pageCount && pageCount > 1 ? (pages?.at(-1)?.items.length ?? 0) : 0;
  setAnnounced({ pageCount, message: added > 0 ? t('library.more.added', { count: added }) : '' });
}

const { fetchNextPage } = assets;
const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
```

у гілці з сіткою:

```tsx
return (
  <>
    <ul className={styles.grid}>{/* як було */}</ul>
    {assets.hasNextPage && (
      <LoadMore
        isLoading={assets.isFetchingNextPage}
        failed={assets.isFetchNextPageError}
        onLoad={loadMore}
      />
    )}
  </>
);
```

і в кінці розмітки сторінки, після `{content}`:

```tsx
<VisuallyHidden aria-live="polite">{announced.message}</VisuallyHidden>
```

Run: `cd apps/web && pnpm vitest run src/pages/library` → PASS. Run: `pnpm typecheck && pnpm lint && pnpm test:web` → PASS; прогін під навантаженням для `src/pages/library` → усі `0`.

- [ ] **Step 6: коміт**

```bash
git add -A apps/web/src
git commit -m "feat(stage-5c.4): load more of the library as it scrolls

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 9: файли в роботі, живі статуси й діалог, що веде в медіатеку

**Files:**

- Modify: `apps/web/src/features/upload/model/uploads-slice.ts` (`kind`, `quotaExceeded`)
- Modify: `apps/web/src/features/upload/model/upload-files.ts` (`kind`, `quotaExceeded`, інвалідація `Asset`)
- Modify: `apps/web/src/features/upload/api/upload-api.ts` (`name`)
- Modify: `apps/web/src/features/upload/ui/UploadPanel.tsx`, `UploadPanel.module.css` (заголовок «Що зробити»)
- Modify: `apps/web/src/features/upload/index.ts` (експорт `MediaKind`, якщо потрібен)
- Create: `apps/web/src/features/assets/model/use-live-assets.ts`; Modify: `features/assets/index.ts`
- Create: `apps/web/src/pages/library/model/pending-uploads.ts`, `pending-uploads.test.ts`
- Create: `apps/web/src/pages/library/ui/UploadTile.tsx`, `UploadTile.module.css`
- Modify: `apps/web/src/pages/library/LibraryPage.tsx`
- Modify: `apps/web/src/pages/jobs/model/describe-item.ts` (`quotaExceeded`)
- Modify: `apps/web/src/app/layouts/AppLayout.tsx`, `app/layouts/use-upload-failure-toasts.ts`
- Modify: locales: `workspace.json` (`problem.quotaExceeded`), `shell.json` (`upload.quotaExceeded`, без `upload.openJobs`), `upload.json` (`options.title`), `assets.json` (`upload.*`)
- Test: `apps/web/src/app/upload-dialog.test.tsx`, `apps/web/src/pages/library/LibraryPage.test.tsx`

**Interfaces:**

```ts
// features/upload
export type Upload = { id; fileName; kind: 'image' | 'video'; previewUrl; createdAt } & (…фази як були);
export type UploadProblem = … | 'quotaExceeded';

// features/assets
export const LIVE_POLL_MS = 3000;
export function useLiveAssets(filters: AssetFilters, options: { awaitedJobIds: readonly string[] }): ReturnType<typeof useListAssetsInfiniteQuery>;

// pages/library/model/pending-uploads.ts
/** Local uploads the server list does not show yet. */
export function pendingUploads(uploads: readonly Upload[], assets: readonly AssetSummary[]): Upload[];
```

- [ ] **Step 1: падаючий юніт-тест «що ще не на сервері»**

`pages/library/model/pending-uploads.test.ts`:

```ts
import { type Upload } from '../../../features/upload';
import { testAsset } from '../../../test/fixtures';
import { pendingUploads } from './pending-uploads';

const base = { fileName: 'a.png', kind: 'image', previewUrl: 'blob:1', createdAt: 1 } as const;

describe('pendingUploads', () => {
  it('drops an upload once the list shows the asset its job made', () => {
    const uploads: Upload[] = [
      { ...base, id: 'u1', phase: 'submitted', jobId: 'job-1' },
      { ...base, id: 'u2', phase: 'submitted', jobId: 'job-2' },
      { ...base, id: 'u3', phase: 'uploading', progress: 0.5 },
      { ...base, id: 'u4', phase: 'failed', problem: 'empty', detail: null },
    ];
    const assets = [
      testAsset({ latestJob: { id: 'job-1', type: 'image.resize', status: 'running' } }),
    ];

    expect(pendingUploads(uploads, assets).map((u) => u.id)).toEqual(['u2', 'u3', 'u4']);
  });
});
```

Run → FAIL (немає модуля; `kind` не в типі `Upload`).

- [ ] **Step 2: завантаження — `kind`, `name`, квота, інвалідація**

`uploads-slice.ts`:

```ts
export type UploadProblem =
  | FileProblem
  | 'unauthorized'
  | 'network'
  | 'rejected'
  | 'rateLimited'
  | 'queueFull'
  | 'quotaExceeded';

export type Upload = {
  id: string;
  fileName: string;
  /** Picks the local preview: object URLs of videos do not render in an <img>. */
  kind: 'image' | 'video';
  previewUrl: string;
  createdAt: number;
} & ( /* фази без змін */ );

type UploadBase = Pick<Upload, 'id' | 'fileName' | 'kind' | 'previewUrl' | 'createdAt'>;
```

`moveTo` копіює й `kind`: `const { fileName, kind, previewUrl, createdAt } = upload; adapter.setOne(state, next({ id, fileName, kind, previewUrl, createdAt }));`. `uploadStarted` payload отримує `kind: 'image' | 'video'`.

`upload-files.ts`:

```ts
function problemOf(error: AppError): { problem: UploadProblem; detail: string | null } {
  switch (error.kind) {
    case 'unauthorized':
      return { problem: 'unauthorized', detail: null };
    case 'retryLater':
      return { problem: reasonOf(error), detail: null };
    case 'http':
      return error.code === 'STORAGE_QUOTA_EXCEEDED'
        ? { problem: 'quotaExceeded', detail: null }
        : { problem: 'rejected', detail: error.message };
    default:
      return { problem: 'network', detail: null };
  }
}
```

у циклі `uploadStarted`: `kind: mediaKindOf(file.type) === 'video' ? 'video' : 'image',`; після `uploadSubmitted`: `dispatch(baseApi.util.invalidateTags(['Job', 'Asset']));`.

`upload-api.ts`, `requestUpload`:

```ts
/** `name` is what the library shows and searches; the gateway rejects longer ones. */
export async function requestUpload(file: File, signal: AbortSignal): Promise<UploadTicket> {
  const { data } = await http.post<UploadTicket>(
    '/v1/uploads',
    { contentType: file.type, size: file.size, name: file.name.slice(0, UPLOAD_NAME_MAX_LENGTH) },
    { signal },
  );
  return data;
}
```

На початку файлу:

```ts
// Mirrors ASSET_NAME_MAX_LENGTH in @pdp/contracts.
const UPLOAD_NAME_MAX_LENGTH = 255;
```

`CreateUploadDto` шлюзу відхиляє довші імена (`@MaxLength(ASSET_NAME_MAX_LENGTH)`), тож обрізання на клієнті потрібне.

`pages/jobs/model/describe-item.ts`: у `PROBLEM_KEY` додати `quotaExceeded: 'problem.quotaExceeded',`.

`workspace.json`: en `"quotaExceeded": "Storage is full. Delete files you no longer need."`, uk `"quotaExceeded": "Місце закінчилося: видаліть непотрібні файли."` (у блоці `problem`).

`UploadPanel.tsx` — перед `<div className={styles.options}>`:

```tsx
<h3 className={styles.optionsTitle}>{t('options.title')}</h3>
```

`UploadPanel.module.css`:

```css
.optionsTitle {
  margin: 0;
  font-size: var(--text-md);
}
```

`upload.json`: en `"options": { "title": "What to do" }`, uk `"options": { "title": "Що зробити" }`. (Заголовок діалогу — `h2`, тож `h3` під ним; якщо `Dialog` рендерить заголовок іншим рівнем — узгодьте.)

Run: `cd apps/web && pnpm vitest run src/pages/library/model src/features/upload` → PASS (після кроку 3 для `pending-uploads`).

- [ ] **Step 3: живі статуси і локальні плитки**

`pages/library/model/pending-uploads.ts`:

```ts
import { type AssetSummary } from '../../../features/assets';
import { type Upload } from '../../../features/upload';

/** Local uploads the server list does not show yet; the slice keeps them for /jobs. */
export function pendingUploads(
  uploads: readonly Upload[],
  assets: readonly AssetSummary[],
): Upload[] {
  const listedJobs = new Set(
    assets.flatMap((asset) => (asset.latestJob ? [asset.latestJob.id] : [])),
  );
  return uploads.filter((upload) => upload.phase !== 'submitted' || !listedJobs.has(upload.jobId));
}
```

`features/assets/model/use-live-assets.ts`:

```ts
import { retryAfterOf } from '../../../shared/api/http';
import { useAppSelector } from '../../../shared/lib/redux';
import { assetsApi, useListAssetsInfiniteQuery } from '../api/assets-api';
import { type AssetFilters, isActiveJobStatus } from '../model/types';

/** Every poll refetches every loaded page, so this is slower than the 1 s on /jobs. */
export const LIVE_POLL_MS = 3000;

/**
 * Polls while a loaded file is still being processed, or while a job of this tab's uploads
 * (`awaitedJobIds`) has not shown up in the list; otherwise not at all. After a 429/503 it
 * waits as long as the gateway asked.
 */
export function useLiveAssets(
  filters: AssetFilters,
  { awaitedJobIds }: { awaitedJobIds: readonly string[] },
) {
  const cached = useAppSelector(assetsApi.endpoints.listAssets.select(filters));
  const items = cached.data?.pages.flatMap((page) => page.items) ?? [];
  const hasActive = items.some(
    (asset) => asset.latestJob !== null && isActiveJobStatus(asset.latestJob.status),
  );
  const listed = new Set(items.flatMap((asset) => (asset.latestJob ? [asset.latestJob.id] : [])));
  const awaiting = awaitedJobIds.some((id) => !listed.has(id));
  const retryAfterS = retryAfterOf(cached.error);
  const pollingInterval =
    retryAfterS !== null
      ? Math.max(retryAfterS * 1000, LIVE_POLL_MS)
      : hasActive || awaiting
        ? LIVE_POLL_MS
        : 0;
  return useListAssetsInfiniteQuery(filters, { pollingInterval, skipPollingIfUnfocused: true });
}
```

Експорт у `features/assets/index.ts`: `export { LIVE_POLL_MS, useLiveAssets } from './model/use-live-assets';`.

`pages/library/ui/UploadTile.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { dismissUpload, type Upload } from '../../../features/upload';
import { useAppDispatch } from '../../../shared/lib/redux';
import { Badge } from '../../../shared/ui/badge/Badge';
import { Button } from '../../../shared/ui/button/Button';
import { Card } from '../../../shared/ui/card/Card';
import { Progress } from '../../../shared/ui/progress/Progress';
import styles from './AssetTile.module.css';

const PROBLEM_KEY = {
  type: 'problem.type',
  size: 'problem.size',
  empty: 'problem.empty',
  unauthorized: 'problem.unauthorized',
  network: 'problem.network',
  rejected: 'problem.rejected',
  rateLimited: 'problem.rateLimited',
  queueFull: 'problem.queueFull',
  quotaExceeded: 'problem.quotaExceeded',
} as const satisfies Record<Extract<Upload, { phase: 'failed' }>['problem'], string>;

/** A file of this tab that the server list does not show yet. */
export function UploadTile({ upload }: { upload: Upload }) {
  const { t } = useTranslation('workspace');
  const { t: tJobs } = useTranslation('jobs');
  const { t: tAssets } = useTranslation('assets');
  const dispatch = useAppDispatch();

  const status = (() => {
    switch (upload.phase) {
      case 'uploading':
        return <Progress label={t('stage.uploading')} value={upload.progress} />;
      case 'creating':
        return <Badge tone="progress">{t('stage.creating')}</Badge>;
      case 'waiting':
        return (
          <Badge tone="warning">
            {t(upload.reason === 'rateLimited' ? 'stage.waitingRateLimit' : 'stage.waitingQueue')}
          </Badge>
        );
      case 'submitted':
        return <Badge tone="neutral">{tJobs('status.queued')}</Badge>;
      case 'failed':
        return (
          <>
            <Badge tone="danger">{t('stage.failed')}</Badge>
            <p className={styles.problem}>{t(PROBLEM_KEY[upload.problem])}</p>
            <Button
              size="sm"
              variant="quiet"
              onClick={() =>
                dispatch(dismissUpload({ id: upload.id, previewUrl: upload.previewUrl }))
              }
            >
              {tAssets('upload.remove')}
            </Button>
          </>
        );
    }
  })();

  return (
    <Card className={styles.tile}>
      <span className={styles.frame}>
        {upload.kind === 'image' ? (
          <img className={styles.image} src={upload.previewUrl} alt="" />
        ) : (
          <span className={styles.placeholder} aria-hidden="true">
            ▶
          </span>
        )}
      </span>
      <span className={styles.name} title={upload.fileName}>
        {upload.fileName}
      </span>
      <span className={styles.meta}>{status}</span>
    </Card>
  );
}
```

Ключ `status.queued` у `jobs.json` вже є («Queued»). У `AssetTile.module.css` додати:

```css
.problem {
  flex-basis: 100%;
  margin: 0;
}
```

`assets.json`: en `"upload": { "remove": "Remove" }`, uk `"upload": { "remove": "Прибрати" }`.

`LibraryPage.tsx`:

```tsx
import { useLiveAssets } from '../../features/assets';
import { selectUploads, useOpenUpload } from '../../features/upload';
import { useAppSelector } from '../../shared/lib/redux';
import { pendingUploads } from './model/pending-uploads';
import { UploadTile } from './ui/UploadTile';
```

Підключення на сторінці (замість `useListAssetsInfiniteQuery(filters)`):

```tsx
const uploads = useAppSelector(selectUploads);
const awaitedJobIds = useMemo(
  () => (isFiltered ? [] : uploads.flatMap((u) => (u.phase === 'submitted' ? [u.jobId] : []))),
  [isFiltered, uploads],
);
const assets = useLiveAssets(filters, { awaitedJobIds });
// ...pages та items — як було...
const pending = useMemo(
  () => (isFiltered ? [] : pendingUploads(uploads, items)),
  [isFiltered, uploads, items],
);
```

Локальні плитки показуються лише без фільтрів: з фільтрами незрозуміло, чи файл під них підпадатиме.

Розмітка: порожній стан показувати лише коли `items.length === 0 && pending.length === 0`; у сітці спершу локальні плитки:

```tsx
      <ul className={styles.grid}>
        {pending.map((upload) => (
          <li key={upload.id}>
            <UploadTile upload={upload} />
          </li>
        ))}
        {items.map((asset) => ( /* як було */ ))}
      </ul>
```

- [ ] **Step 4: діалог веде в медіатеку; правило тостів**

`AppLayout.tsx`:

```tsx
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
// buttonClass більше не потрібен — прибрати з імпорту, якщо ніде не використовується

const navigate = useNavigate();
const handleStarted = (count: number) => {
  if (pathname !== '/library') void navigate('/library');
  toast({ tone: 'progress', message: t('upload.started', { count }) });
};
```

`use-upload-failure-toasts.ts`:

```ts
/** Pages that show failed uploads on their own tiles. */
const PAGES_WITH_UPLOADS = ['/library', '/jobs'];

/**
 * Failed uploads show on the library and the jobs sheet; elsewhere nobody would see them,
 * so they come as alerts. Each failure is reported once.
 */
export function useUploadFailureToasts(): void {
  // ...як було, але:
  if (!PAGES_WITH_UPLOADS.includes(pathname)) {
    toast({
      tone: 'danger',
      message: t(upload.problem === 'quotaExceeded' ? 'upload.quotaExceeded' : 'upload.failed', {
        name: upload.fileName,
      }),
    });
  }
}
```

`shell.json`: видалити `upload.openJobs`; додати en `"quotaExceeded": "{{name}} was not uploaded: storage is full. Delete files you no longer need."`, uk `"quotaExceeded": "{{name}} не завантажено: місце закінчилося. Видаліть непотрібні файли."` (у блоці `upload`).

- [ ] **Step 5: тести діалогу й медіатеки**

`app/upload-dialog.test.tsx`:

1. У `uploadHandlers()` додати список файлів, що з'являється після створення задачі, і запис тіла запиту на завантаження:

```tsx
const ASSET = testAsset({
  id: 'a0000000-0000-4000-8000-000000000009',
  name: 'harbour.png',
  preview: null,
  latestJob: { id: JOB_ID, type: 'image.resize', status: 'queued' },
});

function uploadHandlers() {
  let created = false;
  const uploadBodies: unknown[] = [];
  server.use(
    http.get('/v1/webhooks', () => HttpResponse.json({ items: [] })),
    http.get('/v1/jobs', () =>
      HttpResponse.json({ items: created ? [queued] : [], nextCursor: null }),
    ),
    http.get('/v1/assets', () =>
      HttpResponse.json({ items: created ? [ASSET] : [], nextCursor: null }),
    ),
    http.post('/v1/uploads', async ({ request }) => {
      uploadBodies.push(await request.json());
      return HttpResponse.json({
        uploadUrl: `${STORAGE_ORIGIN}/sources/9.png?sig=x`,
        sourceKey: 'sources/9.png',
      });
    }),
    /* options, put, post /v1/jobs — як було */
  );
  return { uploadBodies };
}
```

2. Тест `'uploads from any page and points to the jobs'` замінити:

```tsx
it('takes the upload to the library, where the file shows once', async () => {
  const { uploadBodies } = uploadHandlers();
  const { user, router } = renderApp({ signedIn: true, route: '/webhooks' });

  await user.click(await screen.findByRole('button', { name: 'Upload' }));
  const dialog = screen.getByRole('dialog', { name: 'Upload files' });
  await user.upload(
    within(dialog).getByLabelText(/Drop images or videos here/, { selector: 'input' }),
    new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
  );

  expect(dialog).not.toHaveAttribute('open');
  expect(await screen.findByText('Uploading 1 file.')).toBeInTheDocument();
  await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
  expect(await screen.findByRole('link', { name: /harbour\.png/ })).toBeInTheDocument();
  // The local tile gave way to the server's one.
  await waitFor(() => expect(screen.getAllByText('harbour.png')).toHaveLength(1));
  expect(uploadBodies).toEqual([{ contentType: 'image/png', size: 64, name: 'harbour.png' }]);
});
```

3. Тест `'offers an upload from the empty jobs page and keeps focus on the page'` — тепер після старту відбувається перехід у медіатеку; перевірити, що фокус на `h1` «Library»: `await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toHaveFocus());` (так працює `PageHeading` після переходу між маршрутами).

4. Тест `'stops and forgets the uploads…'` — після старту сторінка вже `/library`; обробник `GET /v1/assets` додати (`[]`); перевірки на `empty.png was not uploaded.` замінити: на `/library` тосту немає, а плитка показує причину — `expect(await screen.findByText('The file is empty.')).toBeInTheDocument()`; після повторного входу (`next` не задано → `/library`) — `expect(screen.queryByText('The file is empty.')).not.toBeInTheDocument()` замість лічильника тостів. Решта — як була.

5. Тест `'alerts about a file that could not be uploaded, away from the jobs page'` замінити:

```tsx
it('alerts about a failure that happens after leaving the library', async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get('/v1/webhooks', () => HttpResponse.json({ items: [] })),
    http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.post('/v1/uploads', async () => {
      await held;
      return HttpResponse.json(
        { statusCode: 413, code: 'STORAGE_QUOTA_EXCEEDED', message: 'quota' },
        { status: 413 },
      );
    }),
  );
  const { user, router } = renderApp({ signedIn: true, route: '/webhooks' });
  await user.click(await screen.findByRole('button', { name: 'Upload' }));
  await user.upload(
    screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
    new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
  await user.click(screen.getByRole('link', { name: 'Webhooks' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/webhooks'));
  release();

  const message = await screen.findByText(
    'harbour.png was not uploaded: storage is full. Delete files you no longer need.',
  );
  expect(message.closest('[aria-live]')).toHaveAttribute('aria-live', 'assertive');
});

it('shows on the tile when storage is full', async () => {
  server.use(
    http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.post('/v1/uploads', () =>
      HttpResponse.json({ code: 'STORAGE_QUOTA_EXCEEDED', message: 'quota' }, { status: 413 }),
    ),
  );
  const { user } = renderApp({ signedIn: true, route: '/library' });
  await user.click(await screen.findByRole('button', { name: 'Upload' }));
  await user.upload(
    screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
    new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
  );
  expect(
    await screen.findByText('Storage is full. Delete files you no longer need.'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/was not uploaded/)).not.toBeInTheDocument();
});
```

(Імпорти: `testAsset` з `../test/fixtures`.)

`pages/library/LibraryPage.test.tsx` — живі статуси:

```tsx
describe('live library', () => {
  it('polls while a file is processing and stops when it is done', async () => {
    let calls = 0;
    server.use(
      http.get('/v1/assets', () => {
        calls += 1;
        const status = calls === 1 ? 'running' : 'succeeded';
        return HttpResponse.json({
          items: [
            testAsset({
              latestJob: {
                id: 'b0000000-0000-4000-8000-000000000001',
                type: 'image.resize',
                status,
              },
            }),
          ],
          nextCursor: null,
        });
      }),
    );
    renderApp({ signedIn: true, route: '/library' });

    expect(await screen.findByText('Processing')).toBeInTheDocument();
    expect(await screen.findByText('Done', {}, { timeout: 5000 })).toBeInTheDocument();
    const settled = calls;
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(calls).toBe(settled);
  }, 15_000);
});
```

(Тест повільний — ~7 с — бо чекає реальний інтервал 3 с двічі; це прийнятна ціна за перевірку і ввімкнення, і вимкнення. Фейкові таймери з MSW тут ненадійні.) Тести не викликають `setupListeners` (його підключає `main.tsx` у задачі 10), тож RTK вважає вікно у фокусі, і `skipPollingIfUnfocused` опитуванню не заважає.

Run: `cd apps/web && pnpm vitest run src/app/upload-dialog.test.tsx src/pages/library src/pages/jobs` → PASS.
Run: `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test:web` → PASS; прогін під навантаженням для `src/app/upload-dialog.test.tsx src/pages/library` → усі `0`.

- [ ] **Step 6: коміт**

```bash
git add -A apps/web/src
git commit -m "feat(stage-5c.4): show uploads in progress in a live library

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 10: сторінка файлу — шапка, оригінал і плеєр, версії, задачі

**Files:**

- Modify: `apps/web/src/shared/api/http.ts`, `http.test.ts` (`httpStatusOf`)
- Modify: `apps/web/src/main.tsx` (`setupListeners`)
- Modify: `apps/web/src/features/assets/model/types.ts`, `api/assets-api.ts`, `index.ts`
- Create: `apps/web/src/features/assets/model/use-live-asset.ts`
- Create: `apps/web/src/pages/asset/model/versions.ts`, `versions.test.ts`
- Create: `apps/web/src/pages/asset/lib/library-search.ts`
- Create: `apps/web/src/pages/asset/ui/VideoPlayer.tsx`, `VersionList.tsx`, `AssetJobs.tsx`, `AssetPage.module.css`
- Modify: `apps/web/src/pages/asset/AssetPage.tsx`
- Modify: `apps/web/src/locales/{en,uk}/assets.json` (`asset.*`, `player.*`, `versions.*`, `jobs.*`), `shell.json` (видалити `asset.*`)
- Test: `apps/web/src/pages/asset/AssetPage.test.tsx`

**Interfaces:**

```ts
// shared/api/http.ts
export function httpStatusOf(value: unknown): number | null; // лише для kind 'http'

// features/assets
type Download = { url: string; downloadUrl: string };
export type AssetImageVersion = {
  preset: string;
  width: number;
  height: number;
  bytes: number;
} & Download;
export type AssetFrame = {
  atSeconds: number;
  width: number;
  height: number;
  bytes: number;
} & Download;
export type AssetRendition = {
  rendition: string;
  width: number;
  height: number;
  durationSeconds: number;
  bytes: number;
  bitrate: number;
} & Download;
export type AssetJob = {
  id;
  type;
  status: AssetJobStatus;
  attempts;
  lastError: string | null;
  deadReason: 'permanent' | 'exhausted' | null;
  createdAt;
  traceId: string | null;
  results?: AssetImageVersion[];
  video?: { durationSeconds; width; height; codec; preview: AssetFrame; frames: AssetFrame[] };
  transcode?: {
    durationSeconds;
    width;
    height;
    codec;
    preview: AssetFrame;
    renditions: AssetRendition[];
  };
};
export type AssetDetails = Asset & {
  originalUrl: string;
  originalDownloadUrl: string;
  jobs: AssetJob[];
  jobsNextCursor: string | null;
};
export function useLiveAsset(id: string): ReturnType<typeof useGetAssetQuery>;

// pages/asset/model/versions.ts
export type Version =
  | ({ id: string; kind: 'image'; preset: string; width; height; bytes } & Download)
  | ({ id: string; kind: 'rendition'; rendition: string; width; height; bytes } & Download)
  | ({ id: string; kind: 'preview'; width; height; bytes } & Download);
export function versionsOf(jobs: readonly AssetJob[]): Version[];
export function framesOf(jobs: readonly AssetJob[]): AssetFrame[];
export function playableOf(jobs: readonly AssetJob[]): {
  renditions: AssetRendition[];
  poster: string | null;
};
export function formatOf(url: string): string; // 'WebP' | 'JPEG' | 'MP4' | 'PNG' | розширення великими

// pages/asset/lib/library-search.ts
export function librarySearchOf(state: unknown): string; // '?kind=image' або ''
```

- [ ] **Step 1: `httpStatusOf` (TDD)**

У `http.test.ts`, в `describe('AppError helpers')`:

```ts
it('reads the status of an HTTP refusal only', () => {
  expect(httpStatusOf({ kind: 'http', status: 404, message: 'gone', code: null })).toBe(404);
  expect(httpStatusOf({ kind: 'unauthorized' })).toBeNull();
  expect(httpStatusOf(undefined)).toBeNull();
});
```

Run → FAIL. У `http.ts`:

```ts
export function httpStatusOf(value: unknown): number | null {
  return isAppError(value) && value.kind === 'http' ? value.status : null;
}
```

Run → PASS.

- [ ] **Step 2: фокус вікна для RTK Query**

`main.tsx`:

```tsx
import { setupListeners } from '@reduxjs/toolkit/query';
// ...
const store = createStore();
// Focus and reconnect events drive `refetchOnFocus` and `skipPollingIfUnfocused`.
setupListeners(store.dispatch);

createRoot(root).render(
  <Providers store={store} i18n={initI18n()}>
    <RouterProvider router={createBrowserRouter(routes)} />
  </Providers>,
);
```

(Тести `setupListeners` не викликають: так у jsdom вікно завжди «у фокусі», і опитування передбачуване.)

- [ ] **Step 3: модель версій (TDD)**

`pages/asset/model/versions.test.ts`:

```ts
import { type AssetFrame, type AssetJob } from '../../../features/assets';
import { formatOf, framesOf, playableOf, versionsOf } from './versions';

const frame = (atSeconds: number, name: string): AssetFrame => ({
  atSeconds,
  width: 640,
  height: 360,
  bytes: 20_000,
  url: `http://storage.test/${name}.jpg`,
  downloadUrl: `http://storage.test/${name}.jpg?dl`,
});

const job = (overrides: Partial<AssetJob>): AssetJob => ({
  id: 'j1',
  type: 'image.resize',
  status: 'succeeded',
  attempts: 1,
  lastError: null,
  deadReason: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  traceId: null,
  ...overrides,
});

describe('versions of a file', () => {
  it('lists results of succeeded jobs only, newest job first', () => {
    const jobs = [
      job({
        id: 'j2',
        type: 'video.transcode',
        transcode: {
          durationSeconds: 12,
          width: 1280,
          height: 720,
          codec: 'h264',
          preview: frame(0, 'preview'),
          renditions: [
            {
              rendition: '480p',
              width: 854,
              height: 480,
              durationSeconds: 12,
              bytes: 1,
              bitrate: 1,
              url: 'http://storage.test/480p.mp4',
              downloadUrl: 'd480',
            },
            {
              rendition: '720p',
              width: 1280,
              height: 720,
              durationSeconds: 12,
              bytes: 2,
              bitrate: 2,
              url: 'http://storage.test/720p.mp4',
              downloadUrl: 'd720',
            },
          ],
        },
      }),
      job({ id: 'j3', status: 'running' }),
      job({
        id: 'j1',
        results: [
          {
            preset: 'thumb',
            width: 200,
            height: 133,
            bytes: 9,
            url: 'http://storage.test/t.webp',
            downloadUrl: 'dt',
          },
        ],
      }),
    ];

    expect(versionsOf(jobs).map((v) => [v.id, v.kind])).toEqual([
      ['j2:720p', 'rendition'],
      ['j2:480p', 'rendition'],
      ['j2:preview', 'preview'],
      ['j1:thumb', 'image'],
    ]);
    expect(playableOf(jobs)).toEqual({
      renditions: [
        expect.objectContaining({ rendition: '720p' }),
        expect.objectContaining({ rendition: '480p' }),
      ],
      poster: 'http://storage.test/preview.jpg',
    });
  });

  it('takes frames from the newest frames job', () => {
    const jobs = [
      job({
        id: 'j2',
        type: 'video.frames',
        video: {
          durationSeconds: 4,
          width: 640,
          height: 360,
          codec: 'h264',
          preview: frame(0, 'p2'),
          frames: [frame(0, 'a'), frame(2, 'b')],
        },
      }),
      job({
        id: 'j1',
        type: 'video.frames',
        video: {
          durationSeconds: 4,
          width: 640,
          height: 360,
          codec: 'h264',
          preview: frame(0, 'p1'),
          frames: [frame(0, 'old')],
        },
      }),
    ];
    expect(framesOf(jobs).map((f) => f.url)).toEqual([
      'http://storage.test/a.jpg',
      'http://storage.test/b.jpg',
    ]);
    expect(playableOf(jobs)).toEqual({ renditions: [], poster: 'http://storage.test/p2.jpg' });
  });

  it('names the format after the file extension', () => {
    expect(formatOf('http://storage.test/r/thumb.webp?X-Amz-Signature=1')).toBe('WebP');
    expect(formatOf('http://storage.test/r/480p.mp4')).toBe('MP4');
    expect(formatOf('http://storage.test/r/frame-0001.jpg')).toBe('JPEG');
    expect(formatOf('http://storage.test/r/x.avif')).toBe('AVIF');
  });
});
```

Run → FAIL.

Типи в `features/assets/model/types.ts` — додати (див. Interfaces; `Download` — неекспортований тип модуля). Експортувати з `index.ts`: `AssetDetails`, `AssetFrame`, `AssetImageVersion`, `AssetJob`, `AssetRendition`.

`pages/asset/model/versions.ts`:

```ts
import {
  type AssetFrame,
  type AssetImageVersion,
  type AssetJob,
  type AssetRendition,
} from '../../../features/assets';

type Download = Pick<AssetImageVersion, 'url' | 'downloadUrl'>;
type Size = { width: number; height: number; bytes: number };

export type Version =
  | ({ id: string; kind: 'image'; preset: string } & Size & Download)
  | ({ id: string; kind: 'rendition'; rendition: string } & Size & Download)
  | ({ id: string; kind: 'preview' } & Size & Download);

const succeeded = (jobs: readonly AssetJob[]) => jobs.filter((job) => job.status === 'succeeded');
const byHeightDesc = (a: AssetRendition, b: AssetRendition) => b.height - a.height;

/** Jobs come newest first from the gateway; versions keep that order. */
export function versionsOf(jobs: readonly AssetJob[]): Version[] {
  return succeeded(jobs).flatMap((job): Version[] => {
    const preview = job.video?.preview ?? job.transcode?.preview;
    return [
      ...(job.results ?? []).map(({ preset, width, height, bytes, url, downloadUrl }) => ({
        id: `${job.id}:${preset}`,
        kind: 'image' as const,
        preset,
        width,
        height,
        bytes,
        url,
        downloadUrl,
      })),
      ...[...(job.transcode?.renditions ?? [])]
        .sort(byHeightDesc)
        .map(({ rendition, width, height, bytes, url, downloadUrl }) => ({
          id: `${job.id}:${rendition}`,
          kind: 'rendition' as const,
          rendition,
          width,
          height,
          bytes,
          url,
          downloadUrl,
        })),
      ...(preview
        ? [
            {
              id: `${job.id}:preview`,
              kind: 'preview' as const,
              width: preview.width,
              height: preview.height,
              bytes: preview.bytes,
              url: preview.url,
              downloadUrl: preview.downloadUrl,
            },
          ]
        : []),
    ];
  });
}

export function framesOf(jobs: readonly AssetJob[]): AssetFrame[] {
  return succeeded(jobs).find((job) => job.video)?.video?.frames ?? [];
}

/** The newest transcode's renditions, best first, and a frame to show before playback. */
export function playableOf(jobs: readonly AssetJob[]): {
  renditions: AssetRendition[];
  poster: string | null;
} {
  const done = succeeded(jobs);
  const transcode = done.find((job) => job.transcode)?.transcode;
  const poster =
    done.map((job) => job.transcode?.preview ?? job.video?.preview).find(Boolean)?.url ?? null;
  return { renditions: [...(transcode?.renditions ?? [])].sort(byHeightDesc), poster };
}

const FORMAT_NAME: Record<string, string> = {
  webp: 'WebP',
  jpg: 'JPEG',
  jpeg: 'JPEG',
  mp4: 'MP4',
  png: 'PNG',
};

export function formatOf(url: string): string {
  const { pathname } = new URL(url);
  const extension = pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase();
  return FORMAT_NAME[extension] ?? extension.toUpperCase();
}
```

(`as const` на `kind` дозволений правилами; prettier розкладе об'єкти по рядках.) Тест версій перевіряє порядок: у межах одного транскоду — 720p, 480p, прев'ю; між задачами — порядок шлюзу (новіші вище).

Run → PASS.

- [ ] **Step 4: API файлу і живі дані**

`features/assets/api/assets-api.ts` — у `endpoints` додати:

```ts
    getAsset: build.query<AssetDetails, string>({
      query: (id) => ({ url: `/v1/assets/${encodeURIComponent(id)}` }),
      providesTags: (_result, _error, id) => [{ type: 'Asset', id }],
    }),
```

і експорт `useGetAssetQuery`.

`features/assets/model/use-live-asset.ts`:

```ts
import { useAppSelector } from '../../../shared/lib/redux';
import { assetsApi, useGetAssetQuery } from '../api/assets-api';
import { isActiveJobStatus } from './types';
import { LIVE_POLL_MS } from './use-live-assets';

/**
 * Polls while a job on the file is still going. Refetches on focus too: the presigned
 * URLs on the page expire after an hour.
 */
export function useLiveAsset(id: string) {
  const cached = useAppSelector(assetsApi.endpoints.getAsset.select(id));
  const hasActive = cached.data?.jobs.some((job) => isActiveJobStatus(job.status)) ?? false;
  return useGetAssetQuery(id, {
    pollingInterval: hasActive ? LIVE_POLL_MS : 0,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
  });
}
```

Експорт з `index.ts`: `useGetAssetQuery`, `useLiveAsset`.

- [ ] **Step 5: тексти**

`assets.json` — додати блоки (en):

```json
  "asset": {
    "breadcrumbs": "Breadcrumbs",
    "loading": "Loading the file…",
    "notFoundTitle": "File not found",
    "notFoundBody": "It may have been deleted, or the link is wrong.",
    "toLibrary": "Back to the library",
    "errorTitle": "Could not load the file",
    "error": "The gateway did not answer. Try again in a moment.",
    "facts": "About the file",
    "dimensions": "Size in pixels",
    "dimensionsValue": "{{width}} × {{height}}",
    "duration": "Duration",
    "size": "File size",
    "type": "Type",
    "uploaded": "Uploaded",
    "downloadOriginal": "Download original",
    "tabs": "File details"
  },
  "player": {
    "label": "Play {{name}}",
    "quality": "Quality",
    "unsupported": "This browser cannot play this format. Transcode it to 480p or 720p.",
    "failed": "This video could not be played."
  },
  "versions": {
    "tab": "Versions",
    "none": "Versions will appear once processing is done.",
    "imageLabel": "{{name}} · {{width}} px",
    "preview": "Preview frame",
    "dimensions": "{{width}} × {{height}}",
    "download": "Download",
    "downloadLabel": "Download {{name}}",
    "frames": "Frames",
    "frameLabel": "Download the frame at {{time}}"
  },
  "jobs": {
    "tab": "Jobs",
    "none": "No jobs on this file yet.",
    "newestOnly": "Showing the {{count}} newest jobs.",
    "type": {
      "resize": "Resize",
      "frames": "Frames",
      "transcode": "Transcode"
    }
  }
```

uk:

```json
  "asset": {
    "breadcrumbs": "Навігаційний ланцюжок",
    "loading": "Завантажуємо файл…",
    "notFoundTitle": "Файл не знайдено",
    "notFoundBody": "Можливо, його видалено або посилання хибне.",
    "toLibrary": "Повернутися в медіатеку",
    "errorTitle": "Не вдалося завантажити файл",
    "error": "Gateway не відповів. Спробуйте за хвилину.",
    "facts": "Про файл",
    "dimensions": "Розмір у пікселях",
    "dimensionsValue": "{{width}} × {{height}}",
    "duration": "Тривалість",
    "size": "Вага",
    "type": "Тип",
    "uploaded": "Завантажено",
    "downloadOriginal": "Завантажити оригінал",
    "tabs": "Подробиці файлу"
  },
  "player": {
    "label": "Відтворити {{name}}",
    "quality": "Якість",
    "unsupported": "Браузер не відтворює цей формат. Зробіть транскодинг у 480p / 720p.",
    "failed": "Не вдалося відтворити це відео."
  },
  "versions": {
    "tab": "Версії",
    "none": "Версії з'являться, коли обробка завершиться.",
    "imageLabel": "{{name}} · {{width}} px",
    "preview": "Кадр-прев'ю",
    "dimensions": "{{width}} × {{height}}",
    "download": "Завантажити",
    "downloadLabel": "Завантажити {{name}}",
    "frames": "Кадри",
    "frameLabel": "Завантажити кадр на {{time}}"
  },
  "jobs": {
    "tab": "Задачі",
    "none": "Задач на цьому файлі ще немає.",
    "newestOnly": "Показано {{count}} найновіших задач.",
    "type": {
      "resize": "Зміна розміру",
      "frames": "Кадри",
      "transcode": "Транскодинг"
    }
  }
```

Назви типів задач (`image.resize`) містять крапку, яку i18next читає як вкладеність, тому ключі — `resize`, `frames`, `transcode`, а код зіставляє їх через мапу `JOB_TYPE_KEY`.

`shell.json` (en/uk): видалити блок `asset`.

- [ ] **Step 6: падаючі тести сторінки**

`pages/asset/AssetPage.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type AssetDetails, type AssetJob } from '../../features/assets';
import { TEST_ASSET, testAsset } from '../../test/fixtures';
import { renderApp } from '../../test/render-app';
import { server, STORAGE_ORIGIN } from '../../test/server';

const ID = 'a0000000-0000-4000-8000-000000000001';

const job = (overrides: Partial<AssetJob> = {}): AssetJob => ({
  id: 'b0000000-0000-4000-8000-000000000001',
  type: 'image.resize',
  status: 'succeeded',
  attempts: 1,
  lastError: null,
  deadReason: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  traceId: null,
  ...overrides,
});

function details(overrides: Partial<AssetDetails> = {}): AssetDetails {
  return {
    ...TEST_ASSET,
    originalUrl: `${STORAGE_ORIGIN}/original`,
    originalDownloadUrl: `${STORAGE_ORIGIN}/original?download`,
    jobs: [
      job({
        results: [
          {
            preset: 'thumb',
            width: 200,
            height: 133,
            bytes: 9_400,
            url: `${STORAGE_ORIGIN}/thumb.webp`,
            downloadUrl: `${STORAGE_ORIGIN}/thumb.webp?download`,
          },
        ],
      }),
    ],
    jobsNextCursor: null,
    ...overrides,
  };
}

const serve = (body: AssetDetails) =>
  server.use(http.get(`/v1/assets/${ID}`, () => HttpResponse.json(body)));

const VIDEO_BASE = {
  kind: 'video' as const,
  name: 'cliffs.mp4',
  contentType: 'video/mp4',
  width: 1920,
  height: 1080,
  durationSeconds: 12,
};

describe('file page', () => {
  it('shows an image with its facts and versions to download', async () => {
    serve(details());
    renderApp({ signedIn: true, route: `/library/${ID}` });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'harbour.jpg' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'harbour.jpg' })).toHaveAttribute(
      'src',
      `${STORAGE_ORIGIN}/original`,
    );
    expect(screen.getByText('1200 × 800')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download original' })).toHaveAttribute(
      'href',
      `${STORAGE_ORIGIN}/original?download`,
    );
    const panel = screen.getByRole('tabpanel', { name: 'Versions' });
    expect(
      within(panel).getByRole('link', { name: 'Download Thumbnail · 200 px' }),
    ).toHaveAttribute('href', `${STORAGE_ORIGIN}/thumb.webp?download`);
    expect(within(panel).getByText('WebP')).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByRole('link', {
        name: 'Library',
      }),
    ).toHaveAttribute('href', '/library');
  });

  it('plays the best transcoded rendition and switches quality', async () => {
    const rendition = (name: string, height: number) => ({
      rendition: name,
      width: Math.round((height * 16) / 9),
      height,
      durationSeconds: 12,
      bytes: 1,
      bitrate: 1,
      url: `${STORAGE_ORIGIN}/${name}.mp4`,
      downloadUrl: `${STORAGE_ORIGIN}/${name}.mp4?download`,
    });
    const preview = {
      atSeconds: 0,
      width: 640,
      height: 360,
      bytes: 1,
      url: `${STORAGE_ORIGIN}/preview.jpg`,
      downloadUrl: `${STORAGE_ORIGIN}/preview.jpg?download`,
    };
    serve(
      details({
        ...VIDEO_BASE,
        jobs: [
          job({
            type: 'video.transcode',
            transcode: {
              durationSeconds: 12,
              width: 1280,
              height: 720,
              codec: 'h264',
              preview,
              renditions: [rendition('480p', 480), rendition('720p', 720)],
            },
          }),
        ],
      }),
    );
    const { user } = renderApp({ signedIn: true, route: `/library/${ID}` });

    const video = await screen.findByLabelText('Play cliffs.mp4');
    expect(video).toHaveAttribute('src', `${STORAGE_ORIGIN}/720p.mp4`);
    expect(video).toHaveAttribute('poster', `${STORAGE_ORIGIN}/preview.jpg`);
    await user.click(screen.getByRole('radio', { name: '480p' }));
    expect(screen.getByLabelText('Play cliffs.mp4')).toHaveAttribute(
      'src',
      `${STORAGE_ORIGIN}/480p.mp4`,
    );
  });

  it('plays the original without a transcode, and explains when the browser cannot', async () => {
    serve(details({ ...VIDEO_BASE, jobs: [] }));
    renderApp({ signedIn: true, route: `/library/${ID}` });

    const video = await screen.findByLabelText('Play cliffs.mp4');
    expect(video).toHaveAttribute('src', `${STORAGE_ORIGIN}/original`);
    fireEvent.error(video);
    expect(
      await screen.findByText(
        'This browser cannot play this format. Transcode it to 480p or 720p.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Versions will appear once processing is done.')).toBeInTheDocument();
  });

  it('lists the jobs on the file with what went wrong', async () => {
    serve(
      details({
        jobs: [
          job({
            status: 'dead',
            attempts: 3,
            lastError: 'unsupported image format',
            deadReason: 'permanent',
          }),
        ],
        jobsNextCursor: 'more',
      }),
    );
    const { user } = renderApp({ signedIn: true, route: `/library/${ID}` });
    await user.click(await screen.findByRole('tab', { name: 'Jobs' }));

    const panel = screen.getByRole('tabpanel', { name: 'Jobs' });
    expect(within(panel).getByText('Resize')).toBeInTheDocument();
    expect(within(panel).getByText('Gave up')).toBeInTheDocument();
    expect(within(panel).getByText('Attempt 3')).toBeInTheDocument();
    expect(within(panel).getByText('unsupported image format')).toBeInTheDocument();
    expect(within(panel).getByText('Showing the 1 newest jobs.')).toBeInTheDocument();
  });

  it('returns to the library with the filters it came from', async () => {
    server.use(
      http.get('/v1/assets', () => HttpResponse.json({ items: [testAsset()], nextCursor: null })),
    );
    serve(details());
    const { user } = renderApp({ signedIn: true, route: '/library?kind=image' });
    await user.click(await screen.findByRole('link', { name: /harbour\.jpg/ }));

    await screen.findByRole('heading', { level: 1, name: 'harbour.jpg' });
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByRole('link', {
        name: 'Library',
      }),
    ).toHaveAttribute('href', '/library?kind=image');
  });

  it('says so when the file does not exist', async () => {
    server.use(
      http.get(`/v1/assets/${ID}`, () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 }),
      ),
    );
    renderApp({ signedIn: true, route: `/library/${ID}` });

    expect(await screen.findByRole('heading', { name: 'File not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the library' })).toHaveAttribute(
      'href',
      '/library',
    );
  });
});
```

Навігація шапки теж має посилання «Library», тому ланцюжок шукаємо в межах `navigation` «Breadcrumbs».

Run: `cd apps/web && pnpm vitest run src/pages/asset` → FAIL.

- [ ] **Step 7: сторінка та її частини**

`pages/asset/lib/library-search.ts`:

```ts
/** The library's query string the user came from, carried in `location.state` by its tiles. */
export function librarySearchOf(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('librarySearch' in state)) return '';
  const { librarySearch } = state;
  return typeof librarySearch === 'string' && librarySearch.startsWith('?') ? librarySearch : '';
}
```

`pages/asset/ui/VideoPlayer.tsx`:

```tsx
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AssetRendition } from '../../../features/assets';
import { ChoiceGroup } from '../../../shared/ui/choice/ChoiceGroup';
import { Radio } from '../../../shared/ui/choice/Radio';
import styles from './AssetPage.module.css';

type VideoPlayerProps = {
  name: string;
  originalUrl: string;
  /** Best first. Without any, the original plays. */
  renditions: readonly AssetRendition[];
  poster: string | null;
};

export function VideoPlayer({ name, originalUrl, renditions, poster }: VideoPlayerProps) {
  const { t } = useTranslation('assets');
  const qualityName = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const current = renditions.find((r) => r.rendition === chosen) ?? renditions[0];
  const src = current?.url ?? originalUrl;

  return (
    <div className={styles.player}>
      {failedSrc === src ? (
        <div className={styles.unplayable}>
          {poster && <img className={styles.original} src={poster} alt="" />}
          <p>{t(current ? 'player.failed' : 'player.unsupported')}</p>
        </div>
      ) : (
        <video
          key={src}
          className={styles.original}
          src={src}
          poster={poster ?? undefined}
          controls
          preload="metadata"
          aria-label={t('player.label', { name })}
          onError={() => setFailedSrc(src)}
        />
      )}
      {renditions.length > 1 && (
        <ChoiceGroup legend={t('player.quality')} className={styles.quality}>
          {renditions.map((rendition) => (
            <Radio
              key={rendition.rendition}
              name={qualityName}
              label={rendition.rendition}
              checked={rendition === current}
              onChange={() => setChosen(rendition.rendition)}
            />
          ))}
        </ChoiceGroup>
      )}
    </div>
  );
}
```

`pages/asset/ui/VersionList.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { type AssetJob } from '../../../features/assets';
import { IMAGE_PRESETS, PRESET_LABEL_KEY } from '../../../features/upload';
import { formatBytes } from '../../../shared/lib/format-bytes';
import { formatDuration } from '../../../shared/lib/format-duration';
import { buttonClass } from '../../../shared/ui/button/Button';
import { formatOf, framesOf, type Version, versionsOf } from '../model/versions';
import styles from './AssetPage.module.css';

// Browsers ignore `download` on cross-origin links; the signed URL's Content-Disposition names the file.
export function VersionList({ jobs }: { jobs: readonly AssetJob[] }) {
  const { t, i18n } = useTranslation('assets');
  const { t: tUpload } = useTranslation('upload');
  const versions = versionsOf(jobs);
  const frames = framesOf(jobs);

  const labelOf = (version: Version): string => {
    if (version.kind === 'rendition') return version.rendition;
    if (version.kind === 'preview') return t('versions.preview');
    const preset = IMAGE_PRESETS.find((p) => p.name === version.preset);
    const name = preset ? tUpload(PRESET_LABEL_KEY[preset.name]) : version.preset;
    return t('versions.imageLabel', { name, width: version.width });
  };

  if (versions.length === 0 && frames.length === 0) {
    return <p className={styles.quiet}>{t('versions.none')}</p>;
  }

  return (
    <div className={styles.versionsPanel}>
      <ul className={styles.versions}>
        {versions.map((version) => {
          const label = labelOf(version);
          return (
            <li key={version.id} className={styles.version}>
              {version.kind === 'rendition' ? (
                <span className={styles.thumbPlaceholder} aria-hidden="true">
                  ▶
                </span>
              ) : (
                <img className={styles.thumb} src={version.url} alt="" loading="lazy" />
              )}
              <span className={styles.versionName}>{label}</span>
              <span>
                {t('versions.dimensions', { width: version.width, height: version.height })}
              </span>
              <span>{formatBytes(version.bytes, i18n.language)}</span>
              <span>{formatOf(version.url)}</span>
              <a
                className={buttonClass({ size: 'sm' })}
                href={version.downloadUrl}
                download
                aria-label={t('versions.downloadLabel', { name: label })}
              >
                {t('versions.download')}
              </a>
            </li>
          );
        })}
      </ul>
      {frames.length > 0 && (
        <section aria-labelledby="asset-frames">
          <h3 id="asset-frames" className={styles.subheading}>
            {t('versions.frames')}
          </h3>
          <ul className={styles.frames}>
            {frames.map((frame) => (
              <li key={frame.url}>
                <a
                  href={frame.downloadUrl}
                  download
                  className={styles.frame}
                  aria-label={t('versions.frameLabel', { time: formatDuration(frame.atSeconds) })}
                >
                  <img
                    src={frame.url}
                    width={frame.width}
                    height={frame.height}
                    alt=""
                    loading="lazy"
                  />
                  <span aria-hidden="true">{formatDuration(frame.atSeconds)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

(`IMAGE_PRESETS` і `PRESET_LABEL_KEY` уже експортуються з `features/upload`. Фіксований `id="asset-frames"` — на сторінці одна така секція; якщо рев'юер наполягатиме — `useId`.)

`pages/asset/ui/AssetJobs.tsx`:

```tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type AssetJob } from '../../../features/assets';
import { STATUS_LABEL_KEY, STATUS_TONE, TraceLink } from '../../../features/jobs';
import { Badge } from '../../../shared/ui/badge/Badge';
import styles from './AssetPage.module.css';

const JOB_TYPE_KEY: Record<string, string> = {
  'image.resize': 'jobs.type.resize',
  'video.frames': 'jobs.type.frames',
  'video.transcode': 'jobs.type.transcode',
};

export function AssetJobs({ jobs, hasMore }: { jobs: readonly AssetJob[]; hasMore: boolean }) {
  const { t, i18n } = useTranslation('assets');
  const { t: tJobs } = useTranslation('jobs');
  const { t: tWorkspace } = useTranslation('workspace');
  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  );

  if (jobs.length === 0) return <p className={styles.quiet}>{t('jobs.none')}</p>;

  return (
    <div className={styles.jobsPanel}>
      <ul className={styles.jobs}>
        {jobs.map((job) => {
          const typeKey = JOB_TYPE_KEY[job.type];
          return (
            <li key={job.id} className={styles.job}>
              <span className={styles.jobType}>{typeKey ? t(typeKey) : job.type}</span>
              <Badge tone={STATUS_TONE[job.status]}>{tJobs(STATUS_LABEL_KEY[job.status])}</Badge>
              <time dateTime={job.createdAt}>{dateTime.format(new Date(job.createdAt))}</time>
              <span>{tWorkspace('attempt', { count: job.attempts })}</span>
              {job.lastError && <p className={styles.jobError}>{job.lastError}</p>}
              <TraceLink jobId={job.id} traceId={job.traceId} createdAt={job.createdAt} />
            </li>
          );
        })}
      </ul>
      {hasMore && <p className={styles.quiet}>{t('jobs.newestOnly', { count: jobs.length })}</p>}
    </div>
  );
}
```

(`JOB_TYPE_KEY[job.type]` з `Record<string, string>` має тип `string` без `undefined`, якщо `noUncheckedIndexedAccess` вимкнено — тоді перевірка `typeKey ?` все одно коректна. Якщо `tsc` скаржиться на «завжди truthy», оголосіть як `Partial<Record<string, string>>`.)

`pages/asset/AssetPage.tsx`:

```tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { type AssetDetails, useLiveAsset } from '../../features/assets';
import { httpStatusOf, retryAfterOf } from '../../shared/api/http';
import { formatBytes } from '../../shared/lib/format-bytes';
import { formatDuration } from '../../shared/lib/format-duration';
import { buttonClass } from '../../shared/ui/button/Button';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import { Skeleton } from '../../shared/ui/skeleton/Skeleton';
import { EmptyState } from '../../shared/ui/state/EmptyState';
import { ErrorState } from '../../shared/ui/state/ErrorState';
import { Tabs } from '../../shared/ui/tabs/Tabs';
import { librarySearchOf } from './lib/library-search';
import { playableOf } from './model/versions';
import { AssetJobs } from './ui/AssetJobs';
import styles from './ui/AssetPage.module.css';
import { VersionList } from './ui/VersionList';
import { VideoPlayer } from './ui/VideoPlayer';

/** A malformed id is refused with 400 before the lookup; for the user both mean "no such file". */
const MISSING = [400, 404];

export function AssetPage() {
  const { t } = useTranslation('assets');
  const { t: tShell } = useTranslation('shell');
  const { assetId = '' } = useParams();
  const asset = useLiveAsset(assetId);

  if (asset.data) return <AssetView asset={asset.data} />;
  if (asset.isError) {
    const status = httpStatusOf(asset.error);
    if (status !== null && MISSING.includes(status)) {
      return (
        <EmptyState
          title={t('asset.notFoundTitle')}
          action={
            <Link to="/library" className={buttonClass()}>
              {t('asset.toLibrary')}
            </Link>
          }
        >
          <p>{t('asset.notFoundBody')}</p>
        </EmptyState>
      );
    }
    const retryAfterS = retryAfterOf(asset.error);
    return (
      <ErrorState
        title={t('asset.errorTitle')}
        retry={{ label: tShell('retry'), onRetry: () => void asset.refetch() }}
      >
        <p>
          {retryAfterS === null
            ? t('asset.error')
            : t('library.tooManyRequests', { count: retryAfterS })}
        </p>
      </ErrorState>
    );
  }
  return (
    <div role="status" aria-busy="true" aria-label={t('asset.loading')} className={styles.page}>
      <Skeleton height="2.5rem" width="20rem" />
      <Skeleton height="24rem" radius="mount" />
    </div>
  );
}

function AssetView({ asset }: { asset: AssetDetails }) {
  const { t, i18n } = useTranslation('assets');
  const location = useLocation();
  const name = asset.name ?? t('tile.untitled');
  const uploaded = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
        new Date(asset.createdAt),
      ),
    [i18n.language, asset.createdAt],
  );
  const { renditions, poster } = playableOf(asset.jobs);

  return (
    <div className={styles.page}>
      <nav aria-label={t('asset.breadcrumbs')}>
        <ol className={styles.crumbs}>
          <li>
            <Link to={`/library${librarySearchOf(location.state)}`}>{t('library.title')}</Link>
          </li>
          <li aria-current="page">{name}</li>
        </ol>
      </nav>
      <div className={styles.header}>
        <PageHeading>{name}</PageHeading>
        <div className={styles.actions}>
          <a className={buttonClass()} href={asset.originalDownloadUrl} download>
            {t('asset.downloadOriginal')}
          </a>
        </div>
      </div>
      <dl className={styles.facts} aria-label={t('asset.facts')}>
        {asset.width !== null && asset.height !== null && (
          <div>
            <dt>{t('asset.dimensions')}</dt>
            <dd>{t('asset.dimensionsValue', { width: asset.width, height: asset.height })}</dd>
          </div>
        )}
        {asset.durationSeconds !== null && (
          <div>
            <dt>{t('asset.duration')}</dt>
            <dd>{formatDuration(asset.durationSeconds)}</dd>
          </div>
        )}
        {asset.size !== null && (
          <div>
            <dt>{t('asset.size')}</dt>
            <dd>{formatBytes(asset.size, i18n.language)}</dd>
          </div>
        )}
        <div>
          <dt>{t('asset.type')}</dt>
          <dd>{asset.contentType}</dd>
        </div>
        <div>
          <dt>{t('asset.uploaded')}</dt>
          <dd>{uploaded}</dd>
        </div>
      </dl>
      {asset.kind === 'video' ? (
        <VideoPlayer
          name={name}
          originalUrl={asset.originalUrl}
          renditions={renditions}
          poster={poster}
        />
      ) : (
        <img
          className={styles.original}
          src={asset.originalUrl}
          width={asset.width ?? undefined}
          height={asset.height ?? undefined}
          alt={name}
        />
      )}
      <Tabs
        label={t('asset.tabs')}
        items={[
          { id: 'versions', label: t('versions.tab'), panel: <VersionList jobs={asset.jobs} /> },
          {
            id: 'jobs',
            label: t('jobs.tab'),
            panel: <AssetJobs jobs={asset.jobs} hasMore={asset.jobsNextCursor !== null} />,
          },
        ]}
      />
    </div>
  );
}
```

`pages/asset/ui/AssetPage.module.css`:

```css
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.crumbs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--graphite);
}

.crumbs li + li::before {
  content: '/';
  margin-right: var(--space-2);
}

.header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4) var(--space-6);
  margin: 0;
}

.facts dt {
  color: var(--graphite);
  font-size: var(--text-sm);
}

.facts dd {
  margin: 0;
}

.original {
  display: block;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 70vh;
  border-radius: var(--radius-mount);
  background: var(--paper-deep);
}

.player,
.unplayable {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.quality {
  flex-direction: row;
  gap: var(--space-3);
}

.versionsPanel,
.jobsPanel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.versions,
.jobs,
.frames {
  margin: 0;
  padding: 0;
  list-style: none;
}

.version {
  display: grid;
  grid-template-columns: 3.5rem minmax(8rem, 1fr) repeat(3, auto) auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--rule);
}

@media (max-width: 40rem) {
  .version {
    grid-template-columns: 3.5rem 1fr auto;
  }
}

.thumb,
.thumbPlaceholder {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: var(--radius-control);
  object-fit: cover;
  background: var(--paper-deep);
}

.thumbPlaceholder {
  display: grid;
  place-items: center;
  color: var(--graphite);
}

.versionName {
  font-weight: 600;
}

.subheading {
  margin: 0 0 var(--space-2);
  font-size: var(--text-md);
}

.frames {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
  gap: var(--space-2);
}

.frame {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: inherit;
  font-size: var(--text-sm);
  text-decoration: none;
}

.frame img {
  width: 100%;
  height: auto;
  border-radius: var(--radius-control);
}

.job {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--rule);
}

.jobType {
  font-weight: 600;
}

.jobError {
  flex-basis: 100%;
  margin: 0;
  color: var(--graphite);
}

.quiet {
  margin: 0;
  color: var(--graphite);
}
```

Токени (`--rule`, `--paper-deep`, `--space-6`, `--text-md`) звірте з `tokens.css`; замість відсутніх — найближчі наявні.

Run: `cd apps/web && pnpm vitest run src/pages/asset src/shared/api` → PASS.
Run: `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test:web` → PASS.

- [ ] **Step 8: коміт**

```bash
git add -A apps/web/src
git commit -m "feat(stage-5c.4): open a file with its player, versions and jobs

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 11: видалення файлу

**Files:**

- Modify: `apps/web/src/features/assets/api/assets-api.ts` (`deleteAsset`), `index.ts`
- Create: `apps/web/src/features/assets/ui/DeleteAssetButton.tsx`, `DeleteAssetButton.module.css`
- Modify: `apps/web/src/pages/asset/AssetPage.tsx`
- Modify: `apps/web/src/locales/{en,uk}/assets.json` (`delete.*`)
- Test: `apps/web/src/pages/asset/AssetPage.test.tsx`

**Interfaces:**

```ts
export function DeleteAssetButton(props: {
  assetId: string;
  name: string;
  onDeleted: () => void;
}): JSX.Element;
// onDeleted викликається і після 204, і після 404 (файл уже видалено)
```

- [ ] **Step 1: падаючі тести**

У `AssetPage.test.tsx`:

```tsx
describe('deleting a file', () => {
  async function openDelete(status: number, body?: object) {
    serve(details());
    server.use(
      http.delete(`/v1/assets/${ID}`, () =>
        body ? HttpResponse.json(body, { status }) : new HttpResponse(null, { status }),
      ),
      http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    const view = renderApp({ signedIn: true, route: `/library/${ID}` });
    await view.user.click(await screen.findByRole('button', { name: 'Delete harbour.jpg' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete harbour.jpg?' });
    return { ...view, dialog };
  }

  it.each([204, 404])('goes back to the library once the file is gone (%i)', async (status) => {
    const { user, router, dialog } = await openDelete(
      status,
      status === 404 ? { message: 'not found' } : undefined,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByText('File deleted.')).toBeInTheDocument();
  });

  it('keeps the dialog open while a job still works on the file', async () => {
    const { user, router, dialog } = await openDelete(409, { code: 'ASSET_BUSY', message: 'busy' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This file is still being processed. Try again when its job finishes.',
    );
    expect(dialog).toHaveAttribute('open');
    expect(router.state.location.pathname).toBe(`/library/${ID}`);
  });

  it('says what the server said when deleting fails otherwise', async () => {
    const { user, dialog } = await openDelete(500, { message: 'storage unavailable' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not delete the file. storage unavailable',
    );
  });

  it('cancels without deleting', async () => {
    const { user, dialog } = await openDelete(204);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dialog).not.toHaveAttribute('open');
  });
});
```

Run → FAIL.

- [ ] **Step 2: API і тексти**

`assets-api.ts` — у `endpoints`:

```ts
    // The file's own page is left alone: refetching it would only show a 404 on the way out.
    deleteAsset: build.mutation<void, string>({
      query: (id) => ({ url: `/v1/assets/${encodeURIComponent(id)}`, method: 'DELETE' }),
      invalidatesTags: (_result, error) =>
        error && httpStatusOf(error) !== 404 ? [] : [ASSET_LIST_TAG],
    }),
```

(імпорт `httpStatusOf` з `../../../shared/api/http`), експорт `useDeleteAssetMutation`.

`assets.json` en:

```json
  "delete": {
    "open": "Delete",
    "openLabel": "Delete {{name}}",
    "title": "Delete {{name}}?",
    "body": "The original and every version will be gone for good.",
    "confirm": "Delete",
    "cancel": "Cancel",
    "close": "Close",
    "busy": "This file is still being processed. Try again when its job finishes.",
    "failed": "Could not delete the file.",
    "done": "File deleted."
  }
```

uk:

```json
  "delete": {
    "open": "Видалити",
    "openLabel": "Видалити {{name}}",
    "title": "Видалити {{name}}?",
    "body": "Оригінал і всі версії зникнуть назавжди.",
    "confirm": "Видалити",
    "cancel": "Скасувати",
    "close": "Закрити",
    "busy": "Файл ще обробляється. Спробуйте, коли задача завершиться.",
    "failed": "Не вдалося видалити файл.",
    "done": "Файл видалено."
  }
```

- [ ] **Step 3: `DeleteAssetButton`**

`features/assets/ui/DeleteAssetButton.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appErrorOf, errorCodeOf, httpStatusOf } from '../../../shared/api/http';
import { Button } from '../../../shared/ui/button/Button';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { useDeleteAssetMutation } from '../api/assets-api';
import styles from './DeleteAssetButton.module.css';

type DeleteAssetButtonProps = { assetId: string; name: string; onDeleted: () => void };

export function DeleteAssetButton({ assetId, name, onDeleted }: DeleteAssetButtonProps) {
  const { t } = useTranslation('assets');
  const [deleteAsset, { isLoading }] = useDeleteAssetMutation();
  const [isOpen, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setProblem(null);
  };

  const confirm = async () => {
    setProblem(null);
    try {
      await deleteAsset(assetId).unwrap();
    } catch (error) {
      // Someone else deleted it first: the outcome the user wanted.
      if (httpStatusOf(error) !== 404) {
        const appError = appErrorOf(error);
        setProblem(
          errorCodeOf(error) === 'ASSET_BUSY'
            ? t('delete.busy')
            : [t('delete.failed'), appError?.kind === 'http' ? appError.message : '']
                .filter(Boolean)
                .join(' '),
        );
        return;
      }
    }
    setOpen(false);
    onDeleted();
  };

  return (
    <>
      <Button
        variant="danger"
        aria-label={t('delete.openLabel', { name })}
        onClick={() => setOpen(true)}
      >
        {t('delete.open')}
      </Button>
      <Dialog
        open={isOpen}
        onClose={close}
        title={t('delete.title', { name })}
        closeLabel={t('delete.close')}
      >
        <p className={styles.body}>{t('delete.body')}</p>
        {problem && (
          <p role="alert" className={styles.problem}>
            {problem}
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="danger" isBusy={isLoading} onClick={() => void confirm()}>
            {t('delete.confirm')}
          </Button>
          <Button onClick={close}>{t('delete.cancel')}</Button>
        </div>
      </Dialog>
    </>
  );
}
```

Хрестик діалогу має окрему мітку «Close», щоб у діалозі не було двох кнопок «Cancel».

`DeleteAssetButton.module.css`:

```css
.body {
  margin: 0 0 var(--space-3);
}

.problem {
  margin: 0 0 var(--space-3);
  color: var(--tone-danger-ink);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
```

(токен кольору помилки — той самий, що в `AuthForm.module.css` з задачі 5.)

Експорт з `features/assets/index.ts`: `DeleteAssetButton`, `useDeleteAssetMutation`.

- [ ] **Step 4: на сторінці**

У `AssetView` (`AssetPage.tsx`):

```tsx
import { useNavigate } from 'react-router';
import { DeleteAssetButton } from '../../features/assets';
import { useToast } from '../../shared/ui/toast/toast-context';

const navigate = useNavigate();
const toast = useToast();
const librarySearch = librarySearchOf(location.state);
const handleDeleted = () => {
  toast({ tone: 'success', message: t('delete.done') });
  void navigate(`/library${librarySearch}`, { replace: true });
};
```

у `.actions` після посилання на оригінал: `<DeleteAssetButton assetId={asset.id} name={name} onDeleted={handleDeleted} />`; ланцюжок використовує ту саму змінну `librarySearch`.

Run: `cd apps/web && pnpm vitest run src/pages/asset` → PASS. Run: `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test:web` → PASS; прогін під навантаженням для `src/pages/asset` → усі `0`.

- [ ] **Step 5: коміт**

```bash
git add -A apps/web/src
git commit -m "feat(stage-5c.4): delete a file from its page

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 12: налаштування — профіль, мова, API-ключі

**Files:**

- Move: `apps/web/src/app/layouts/LanguageSwitch.tsx`, `LanguageSwitch.module.css` → `apps/web/src/features/language/ui/`
- Create: `apps/web/src/features/language/index.ts`
- Modify: `apps/web/src/app/layouts/PublicLayout.tsx`, `UserMenu.tsx` (імпорт `LanguageSwitch`)
- Modify: `apps/web/src/shared/api/base-api.ts` (тег `ApiKey`)
- Create: `apps/web/src/features/api-keys/index.ts`, `model/types.ts`, `api/api-keys-api.ts`
- Create: `apps/web/src/features/api-keys/ui/ApiKeysSection.tsx`, `CreateKeyForm.tsx`, `NewKeyDialog.tsx`, `RevokeKeyButton.tsx`, `ApiKeys.module.css`
- Create: `apps/web/src/locales/{en,uk}/apiKeys.json`, `locales/{en,uk}/settings.json`
- Modify: `apps/web/src/app/i18n.ts`, `locales/{en,uk}/shell.json` (видалити блок `settings`)
- Modify: `apps/web/src/pages/settings/SettingsPage.tsx`; Create: `SettingsPage.module.css`
- Test: `apps/web/src/pages/settings/SettingsPage.test.tsx`

**Interfaces:**

```ts
// features/language
export function LanguageSwitch(): JSX.Element;

// features/api-keys
export const API_KEY_MAX_PER_USER = 10; // mirrors @pdp/contracts
export const API_KEY_NAME_MAX_LENGTH = 100; // mirrors @pdp/contracts
export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};
export type CreatedApiKey = ApiKey & { key: string };
export function ApiKeysSection(): JSX.Element;
```

- [ ] **Step 1: `LanguageSwitch` у фічу**

```bash
mkdir -p apps/web/src/features/language/ui
git mv apps/web/src/app/layouts/LanguageSwitch.tsx apps/web/src/features/language/ui/LanguageSwitch.tsx
git mv apps/web/src/app/layouts/LanguageSwitch.module.css apps/web/src/features/language/ui/LanguageSwitch.module.css
```

`features/language/index.ts`: `export { LanguageSwitch } from './ui/LanguageSwitch';`. У `PublicLayout.tsx` і `UserMenu.tsx`: `import { LanguageSwitch } from '../../features/language';`.

Run: `pnpm typecheck && pnpm depcruise && pnpm test:web` → PASS (поведінка не змінилася).

- [ ] **Step 2: падаючі тести налаштувань**

`pages/settings/SettingsPage.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type ApiKey } from '../../features/api-keys';
import { renderApp } from '../../test/render-app';
import { server } from '../../test/server';

const CI_KEY: ApiKey = {
  id: 'c0000000-0000-4000-8000-000000000001',
  name: 'ci',
  prefix: 'pdp_ab12',
  createdAt: '2026-10-10T10:00:00.000Z',
  lastUsedAt: null,
};
const SECRET = 'pdp_cd34_0123456789abcdef';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** An in-memory key store behind the three endpoints. */
function keysApi(initial: ApiKey[] = [CI_KEY]) {
  let items = [...initial];
  const revoked: string[] = [];
  server.use(
    http.get('/v1/api-keys', () => HttpResponse.json({ items })),
    http.post('/v1/api-keys', async ({ request }) => {
      const body: unknown = await request.json();
      const name = isRecord(body) && typeof body.name === 'string' ? body.name : '';
      const stored: ApiKey = {
        id: 'c0000000-0000-4000-8000-000000000002',
        name,
        prefix: 'pdp_cd34',
        createdAt: '2026-10-15T10:00:00.000Z',
        lastUsedAt: null,
      };
      items = [...items, stored];
      return HttpResponse.json({ ...stored, key: SECRET }, { status: 201 });
    }),
    http.delete('/v1/api-keys/:id', ({ params }) => {
      revoked.push(String(params.id));
      items = items.filter((key) => key.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { revoked };
}

describe('settings', () => {
  it('shows the profile and lets the language change', async () => {
    keysApi();
    renderApp({ signedIn: true, route: '/settings' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const profile = screen.getByRole('region', { name: 'Profile' });
    expect(within(profile).getByText('dev@example.com')).toBeInTheDocument();
    expect(within(profile).getByText('dev')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Language' })).getByRole('group', {
        name: 'Language',
      }),
    ).toBeInTheDocument();
  });

  it('lists keys with their prefix and when they were last used', async () => {
    keysApi();
    renderApp({ signedIn: true, route: '/settings' });

    const row = (await screen.findByText('ci')).closest('li');
    expect(row).not.toBeNull();
    if (!row) return;
    expect(within(row).getByText('pdp_ab12…')).toBeInTheDocument();
    expect(within(row).getByText('Never used')).toBeInTheDocument();
  });

  it('shows a new key once, copies it, and forgets it on close', async () => {
    keysApi();
    const { user } = renderApp({ signedIn: true, route: '/settings' });
    await user.type(await screen.findByLabelText('Key name'), 'deploy');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    const dialog = await screen.findByRole('dialog', { name: 'Your new API key' });
    expect(within(dialog).getByLabelText('API key')).toHaveValue(SECRET);
    expect(within(dialog).getByText(new RegExp(`X-API-Key: ${SECRET}`))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe(SECRET);
    expect(within(dialog).getByText('Copied.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(dialog).not.toHaveAttribute('open');
    expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
    expect(await screen.findByText('deploy')).toBeInTheDocument();
    expect(screen.getByLabelText('Key name')).toHaveValue('');
  });

  it('wants a name for a new key', async () => {
    keysApi();
    const { user } = renderApp({ signedIn: true, route: '/settings' });
    await user.click(await screen.findByRole('button', { name: 'Create key' }));

    expect(
      screen.getByText('Name the key, e.g. after the script that uses it.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Key name')).toHaveFocus();
  });

  it('stops at ten keys', async () => {
    keysApi(
      Array.from({ length: 10 }, (_, index) => ({
        ...CI_KEY,
        id: `c0000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
        name: `key ${index}`,
      })),
    );
    renderApp({ signedIn: true, route: '/settings' });

    await screen.findByText('key 9');
    expect(screen.getByLabelText('Key name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled();
    expect(
      screen.getByText('You have reached the limit of 10 keys. Revoke one you no longer need.'),
    ).toBeInTheDocument();
  });

  it('revokes a key after asking', async () => {
    const { revoked } = keysApi();
    const { user } = renderApp({ signedIn: true, route: '/settings' });
    await user.click(await screen.findByRole('button', { name: 'Revoke ci' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke ci?' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(revoked).toEqual([CI_KEY.id]));
    expect(await screen.findByText(/No keys yet/)).toBeInTheDocument();
  });

  it('offers a retry when the keys do not load', async () => {
    let calls = 0;
    server.use(
      http.get('/v1/api-keys', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ message: 'down' }, { status: 500 })
          : HttpResponse.json({ items: [CI_KEY] });
      }),
    );
    const { user } = renderApp({ signedIn: true, route: '/settings' });

    expect(
      await screen.findByRole('heading', { name: 'Could not load API keys' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('ci')).toBeInTheDocument();
  });
});
```

`userEvent.setup()` підміняє `navigator.clipboard` власною заглушкою, тож `readText()` повертає те, що записав компонент. `region` з іменем дає `<section aria-labelledby>` (див. крок 5).

Run: `cd apps/web && pnpm vitest run src/pages/settings` → FAIL.

- [ ] **Step 3: тексти**

`locales/en/settings.json`:

```json
{
  "title": "Settings",
  "profile": {
    "title": "Profile",
    "name": "Name",
    "email": "Email"
  },
  "language": {
    "title": "Language"
  },
  "apiKeys": {
    "title": "API keys",
    "lead": "Scripts and integrations call the API with a key instead of signing in."
  }
}
```

`locales/uk/settings.json`:

```json
{
  "title": "Налаштування",
  "profile": {
    "title": "Профіль",
    "name": "Ім'я",
    "email": "Email"
  },
  "language": {
    "title": "Мова"
  },
  "apiKeys": {
    "title": "API-ключі",
    "lead": "Скрипти й інтеграції викликають API з ключем замість входу."
  }
}
```

`locales/en/apiKeys.json`:

```json
{
  "list": {
    "loading": "Loading API keys…",
    "errorTitle": "Could not load API keys",
    "error": "The gateway did not answer. Try again in a moment.",
    "empty": "No keys yet. Scripts and integrations need one to call the API.",
    "created": "Created {{date}}",
    "lastUsed": "Last used {{date}}",
    "neverUsed": "Never used",
    "revoke": "Revoke",
    "revokeLabel": "Revoke {{name}}"
  },
  "create": {
    "name": "Key name",
    "hint": "Up to {{count}} characters, e.g. ci or backup-script.",
    "required": "Name the key, e.g. after the script that uses it.",
    "submit": "Create key",
    "limit": "You have reached the limit of {{count}} keys. Revoke one you no longer need.",
    "failed": "Could not create the key. Try again."
  },
  "created": {
    "title": "Your new API key",
    "once": "Copy it now: it will not be shown again.",
    "key": "API key",
    "copy": "Copy",
    "copied": "Copied.",
    "copyManually": "The key is selected. Press Ctrl+C (⌘C on a Mac) to copy it.",
    "example": "Try it:",
    "done": "Done",
    "close": "Close"
  },
  "revoke": {
    "title": "Revoke {{name}}?",
    "body": "Scripts that use this key will stop working at once.",
    "confirm": "Revoke",
    "cancel": "Cancel",
    "close": "Close",
    "failed": "Could not revoke the key. Try again."
  }
}
```

`locales/uk/apiKeys.json`:

```json
{
  "list": {
    "loading": "Завантажуємо API-ключі…",
    "errorTitle": "Не вдалося завантажити API-ключі",
    "error": "Gateway не відповів. Спробуйте за хвилину.",
    "empty": "Ключів ще немає. Вони потрібні скриптам та інтеграціям, щоб викликати API.",
    "created": "Створено {{date}}",
    "lastUsed": "Востаннє використано {{date}}",
    "neverUsed": "Ще не використовувався",
    "revoke": "Відкликати",
    "revokeLabel": "Відкликати {{name}}"
  },
  "create": {
    "name": "Назва ключа",
    "hint": "До {{count}} символів, напр. ci або backup-script.",
    "required": "Назвіть ключ, напр. за скриптом, що ним користується.",
    "submit": "Створити ключ",
    "limit": "Досягнуто ліміту в {{count}} ключів — відкличте непотрібний.",
    "failed": "Не вдалося створити ключ. Спробуйте ще раз."
  },
  "created": {
    "title": "Ваш новий API-ключ",
    "once": "Скопіюйте його зараз: більше не покажемо.",
    "key": "API-ключ",
    "copy": "Копіювати",
    "copied": "Скопійовано.",
    "copyManually": "Ключ виділено. Натисніть Ctrl+C (⌘C на Mac), щоб скопіювати.",
    "example": "Спробуйте:",
    "done": "Готово",
    "close": "Закрити"
  },
  "revoke": {
    "title": "Відкликати {{name}}?",
    "body": "Скрипти з цим ключем одразу перестануть працювати.",
    "confirm": "Відкликати",
    "cancel": "Скасувати",
    "close": "Закрити",
    "failed": "Не вдалося відкликати ключ. Спробуйте ще раз."
  }
}
```

`app/i18n.ts`: додати простори `settings` і `apiKeys`. `shell.json` (en/uk): видалити блок `settings` (`menu.settings` лишається).

- [ ] **Step 4: фіча `api-keys`**

`shared/api/base-api.ts`: `tagTypes: ['Job', 'Webhook', 'Me', 'Asset', 'ApiKey']`.

`features/api-keys/model/types.ts`:

```ts
// Mirror libs/contracts/src/accounts.ts; the gateway enforces them.
export const API_KEY_MAX_PER_USER = 10;
export const API_KEY_NAME_MAX_LENGTH = 100;

export type ApiKey = {
  id: string;
  name: string;
  /** First characters of the key, to tell keys apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/** Only the create response carries the key itself. */
export type CreatedApiKey = ApiKey & { key: string };
```

`features/api-keys/api/api-keys-api.ts`:

```ts
import { baseApi } from '../../../shared/api/base-api';
import { type ApiKey, type CreatedApiKey } from '../model/types';

export const apiKeysApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listApiKeys: build.query<{ items: ApiKey[] }, void>({
      query: () => ({ url: '/v1/api-keys' }),
      providesTags: ['ApiKey'],
    }),
    createApiKey: build.mutation<CreatedApiKey, { name: string }>({
      query: (body) => ({ url: '/v1/api-keys', method: 'POST', data: body }),
      invalidatesTags: ['ApiKey'],
    }),
    // A 404 means it is already gone; the list refetch shows that either way.
    revokeApiKey: build.mutation<void, string>({
      query: (id) => ({ url: `/v1/api-keys/${encodeURIComponent(id)}`, method: 'DELETE' }),
      invalidatesTags: ['ApiKey'],
    }),
  }),
});

export const { useListApiKeysQuery, useCreateApiKeyMutation, useRevokeApiKeyMutation } = apiKeysApi;
```

`features/api-keys/ui/CreateKeyForm.tsx`:

```tsx
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorCodeOf } from '../../../shared/api/http';
import { Button } from '../../../shared/ui/button/Button';
import { Field } from '../../../shared/ui/field/Field';
import { Input } from '../../../shared/ui/field/Input';
import { useCreateApiKeyMutation } from '../api/api-keys-api';
import { API_KEY_MAX_PER_USER, API_KEY_NAME_MAX_LENGTH, type CreatedApiKey } from '../model/types';
import styles from './ApiKeys.module.css';

type CreateKeyFormProps = { atLimit: boolean; onCreated: (key: CreatedApiKey) => void };

export function CreateKeyForm({ atLimit, onCreated }: CreateKeyFormProps) {
  const { t } = useTranslation('apiKeys');
  const [createApiKey, { isLoading }] = useCreateApiKeyMutation();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem(t('create.required'));
      inputRef.current?.focus();
      return;
    }
    setProblem(null);
    try {
      const created = await createApiKey({ name: trimmed }).unwrap();
      setName('');
      onCreated(created);
    } catch (error) {
      setProblem(
        errorCodeOf(error) === 'API_KEY_LIMIT_REACHED'
          ? t('create.limit', { count: API_KEY_MAX_PER_USER })
          : t('create.failed'),
      );
    }
  };

  return (
    <form className={styles.create} noValidate onSubmit={(event) => void handleSubmit(event)}>
      <Field
        label={t('create.name')}
        hint={
          atLimit
            ? t('create.limit', { count: API_KEY_MAX_PER_USER })
            : t('create.hint', { count: API_KEY_NAME_MAX_LENGTH })
        }
        error={problem ?? undefined}
        className={styles.name}
      >
        {(control) => (
          <Input
            {...control}
            ref={inputRef}
            value={name}
            maxLength={API_KEY_NAME_MAX_LENGTH}
            disabled={atLimit}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" isBusy={isLoading} disabled={atLimit}>
        {t('create.submit')}
      </Button>
    </form>
  );
}
```

`features/api-keys/ui/NewKeyDialog.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/ui/button/Button';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { Field } from '../../../shared/ui/field/Field';
import { Input } from '../../../shared/ui/field/Input';
import { type CreatedApiKey } from '../model/types';
import styles from './ApiKeys.module.css';

type CopyState = 'idle' | 'copied' | 'manual';

/** The only place the full key is ever shown; closing the dialog drops it from memory. */
export function NewKeyDialog({
  apiKey,
  onClose,
}: {
  apiKey: CreatedApiKey | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('apiKeys');
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const key = apiKey?.key ?? '';

  const close = () => {
    setCopyState('idle');
    onClose();
  };

  const copy = async () => {
    try {
      // Missing outside secure contexts (plain http on a LAN address): that throws too.
      await navigator.clipboard.writeText(key);
      setCopyState('copied');
    } catch {
      inputRef.current?.select();
      setCopyState('manual');
    }
  };

  return (
    <Dialog
      open={apiKey !== null}
      onClose={close}
      title={t('created.title')}
      closeLabel={t('created.close')}
    >
      <div className={styles.created}>
        <p className={styles.warning}>{t('created.once')}</p>
        <Field label={t('created.key')}>
          {(control) => (
            <Input
              {...control}
              ref={inputRef}
              readOnly
              spellCheck={false}
              value={key}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </Field>
        <div className={styles.row}>
          <Button onClick={() => void copy()}>{t('created.copy')}</Button>
          <p aria-live="polite" className={styles.status}>
            {copyState === 'copied' && t('created.copied')}
            {copyState === 'manual' && t('created.copyManually')}
          </p>
        </div>
        <p>{t('created.example')}</p>
        <pre className={styles.example}>
          <code>{`curl -H "X-API-Key: ${key}" ${window.location.origin}/v1/jobs`}</code>
        </pre>
        <Button variant="primary" className={styles.done} onClick={close}>
          {t('created.done')}
        </Button>
      </div>
    </Dialog>
  );
}
```

`features/api-keys/ui/RevokeKeyButton.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpStatusOf } from '../../../shared/api/http';
import { Button } from '../../../shared/ui/button/Button';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { useRevokeApiKeyMutation } from '../api/api-keys-api';
import { type ApiKey } from '../model/types';
import styles from './ApiKeys.module.css';

export function RevokeKeyButton({ apiKey }: { apiKey: ApiKey }) {
  const { t } = useTranslation('apiKeys');
  const [revoke, { isLoading }] = useRevokeApiKeyMutation();
  const [isOpen, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const close = () => {
    setOpen(false);
    setFailed(false);
  };

  const confirm = async () => {
    setFailed(false);
    try {
      await revoke(apiKey.id).unwrap();
    } catch (error) {
      if (httpStatusOf(error) !== 404) {
        setFailed(true);
        return;
      }
    }
    close();
  };

  return (
    <>
      <Button
        size="sm"
        variant="quiet"
        aria-label={t('list.revokeLabel', { name: apiKey.name })}
        onClick={() => setOpen(true)}
      >
        {t('list.revoke')}
      </Button>
      <Dialog
        open={isOpen}
        onClose={close}
        title={t('revoke.title', { name: apiKey.name })}
        closeLabel={t('revoke.close')}
      >
        <p>{t('revoke.body')}</p>
        {failed && (
          <p role="alert" className={styles.problem}>
            {t('revoke.failed')}
          </p>
        )}
        <div className={styles.row}>
          <Button variant="danger" isBusy={isLoading} onClick={() => void confirm()}>
            {t('revoke.confirm')}
          </Button>
          <Button onClick={close}>{t('revoke.cancel')}</Button>
        </div>
      </Dialog>
    </>
  );
}
```

`features/api-keys/ui/ApiKeysSection.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '../../../shared/ui/skeleton/Skeleton';
import { ErrorState } from '../../../shared/ui/state/ErrorState';
import { useListApiKeysQuery } from '../api/api-keys-api';
import { API_KEY_MAX_PER_USER, type CreatedApiKey } from '../model/types';
import styles from './ApiKeys.module.css';
import { CreateKeyForm } from './CreateKeyForm';
import { NewKeyDialog } from './NewKeyDialog';
import { RevokeKeyButton } from './RevokeKeyButton';

export function ApiKeysSection() {
  const { t, i18n } = useTranslation('apiKeys');
  const { t: tShell } = useTranslation('shell');
  const keys = useListApiKeysQuery();
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );
  const items = keys.data?.items ?? [];

  const list = (() => {
    if (keys.isLoading) {
      return (
        <div role="status" aria-busy="true" aria-label={t('list.loading')}>
          <Skeleton height="3rem" />
        </div>
      );
    }
    if (keys.isError && !keys.data) {
      return (
        <ErrorState
          title={t('list.errorTitle')}
          headingLevel={3}
          retry={{ label: tShell('retry'), onRetry: () => void keys.refetch() }}
        >
          <p>{t('list.error')}</p>
        </ErrorState>
      );
    }
    if (items.length === 0) return <p className={styles.quiet}>{t('list.empty')}</p>;
    return (
      <ul className={styles.keys}>
        {items.map((key) => (
          <li key={key.id} className={styles.key}>
            <span className={styles.keyName}>{key.name}</span>
            <code>{`${key.prefix}…`}</code>
            <span className={styles.quiet}>
              {t('list.created', { date: date.format(new Date(key.createdAt)) })}
            </span>
            <span className={styles.quiet}>
              {key.lastUsedAt
                ? t('list.lastUsed', { date: date.format(new Date(key.lastUsedAt)) })
                : t('list.neverUsed')}
            </span>
            <RevokeKeyButton apiKey={key} />
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <div className={styles.section}>
      {list}
      <CreateKeyForm atLimit={items.length >= API_KEY_MAX_PER_USER} onCreated={setCreated} />
      <NewKeyDialog apiKey={created} onClose={() => setCreated(null)} />
    </div>
  );
}
```

`features/api-keys/ui/ApiKeys.module.css`:

```css
.section,
.created {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.keys {
  margin: 0;
  padding: 0;
  list-style: none;
}

.key {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--rule);
}

.keyName {
  font-weight: 600;
}

.quiet,
.status {
  margin: 0;
  color: var(--graphite);
}

.create {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3);
}

.name {
  flex: 1 1 16rem;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.warning {
  margin: 0;
  font-weight: 600;
}

.example {
  margin: 0;
  padding: var(--space-3);
  overflow-x: auto;
  border-radius: var(--radius-control);
  background: var(--paper-deep);
  font-size: var(--text-sm);
}

.problem {
  margin: 0;
  color: var(--tone-danger-ink);
}

.done {
  align-self: flex-start;
}
```

`features/api-keys/index.ts`:

```ts
export { apiKeysApi } from './api/api-keys-api';
export {
  API_KEY_MAX_PER_USER,
  API_KEY_NAME_MAX_LENGTH,
  type ApiKey,
  type CreatedApiKey,
} from './model/types';
export { ApiKeysSection } from './ui/ApiKeysSection';
```

- [ ] **Step 5: сторінка**

`pages/settings/SettingsPage.tsx`:

```tsx
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiKeysSection } from '../../features/api-keys';
import { useGetMeQuery } from '../../features/auth';
import { LanguageSwitch } from '../../features/language';
import { Card } from '../../shared/ui/card/Card';
import { PageHeading } from '../../shared/ui/page-heading/PageHeading';
import pageStyles from '../page.module.css';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const { data: me } = useGetMeQuery();
  const ids = { profile: useId(), language: useId(), keys: useId() };

  return (
    <div className={`${pageStyles.page} ${pageStyles.narrow}`}>
      <PageHeading>{t('title')}</PageHeading>
      <Card className={styles.section}>
        <section aria-labelledby={ids.profile}>
          <h2 id={ids.profile} className={styles.heading}>
            {t('profile.title')}
          </h2>
          {me && (
            <dl className={styles.facts}>
              <div>
                <dt>{t('profile.name')}</dt>
                <dd>{me.name}</dd>
              </div>
              {me.email && (
                <div>
                  <dt>{t('profile.email')}</dt>
                  <dd>{me.email}</dd>
                </div>
              )}
            </dl>
          )}
        </section>
      </Card>
      <Card className={styles.section}>
        <section aria-labelledby={ids.language}>
          <h2 id={ids.language} className={styles.heading}>
            {t('language.title')}
          </h2>
          <LanguageSwitch />
        </section>
      </Card>
      <Card className={styles.section}>
        <section aria-labelledby={ids.keys}>
          <h2 id={ids.keys} className={styles.heading}>
            {t('apiKeys.title')}
          </h2>
          <p className={styles.lead}>{t('apiKeys.lead')}</p>
          <ApiKeysSection />
        </section>
      </Card>
    </div>
  );
}
```

(Хуки `useId` викликаються безумовно в фіксованому порядку — правило хуків дотримано.)

`pages/settings/SettingsPage.module.css`:

```css
.section {
  padding: var(--space-5);
}

.heading {
  margin: 0 0 var(--space-3);
  font-size: var(--text-lg);
}

.lead {
  margin: 0 0 var(--space-4);
  color: var(--graphite);
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-6);
  margin: 0;
}

.facts dt {
  color: var(--graphite);
  font-size: var(--text-sm);
}

.facts dd {
  margin: 0;
}
```

Run: `cd apps/web && pnpm vitest run src/pages/settings` → PASS.
Run: `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test:web` → PASS; прогін під навантаженням для `src/pages/settings` → усі `0`.

- [ ] **Step 6: коміт**

```bash
git add -A apps/web/src
git commit -m "feat(stage-5c.4): manage API keys and language in settings

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

---

## Задача 13: документи й фінальна перевірка

**Files:**

- Modify: `README.md`
- Modify: `docs/plan/stages-5c-5d.md`
- Modify: `docs/design/information-architecture.md`, `docs/design/design-system.md`
- Modify: `docs/superpowers/specs/2026-10-15-stage-5c4-screens-design.md` (відхилення)
- Modify: `docs/superpowers/plans/2026-10-15-stage-5c4-screens.md` (галочки)
- Create (git-ignored): `.superpowers/sdd/pw/screens.mjs`

- [ ] **Step 1: README**

1. Розділ запуску (рядки ~182–197, «Два способи увійти…»): перший спосіб для браузера — реєстрація на `http://localhost:18090/register` або

```bash
docker compose exec -T metadata node dist/seed-user.js --name me \
  --email me@example.com --password 'correct horse battery' | jq -c '{userId, email}'
```

другий — API-ключ для скриптів (`seed-user` без `--email`, або «Налаштування → API-ключі» у Web UI). Прибрати «цей ключ вставляється у Web UI». Те саме для k3d (рядок ~223).

2. Новий розділ `### Етап 5c.4. Екрани входу, медіатеки й налаштувань` після 5c.3, за зразком попередніх: що з'явилося (вхід і реєстрація, медіатека з фільтрами `?kind&status&q`, нескінченна прокрутка, живі статуси, сторінка файлу з плеєром і завантаженням версій, видалення, налаштування з API-ключами); API: `GET /v1/assets?status=&q=`, `downloadUrl` і `originalDownloadUrl` у `GET /v1/assets/:id`; ручна перевірка — 6–8 кроків (зареєструватися → завантажити фото й відео → медіатека з живим статусом → фільтр «Відео» і пошук → сторінка файлу, 480p/720p, «Завантажити» → видалити → створити ключ і `curl -H "X-API-Key: …" http://localhost:18090/v1/jobs` → відкликати → той самий `curl` дає 401).

- [ ] **Step 2: план етапів і дизайн-документи**

- `docs/plan/stages-5c-5d.md`: відмітити пункти 5c.4 з короткими примітками (як для 5c.3): API-ключ прибрано з браузера, `features/auth`, медіатека на `infiniteQuery`, `downloadUrl`.
- `docs/design/information-architecture.md`: потік завантаження — після старту перехід у `/library`, тост без дії, помилки на плитках, тост лише поза `/library` і `/jobs`; стрілка `413 → quotaExceeded` — суцільна (реалізовано); вхід — email і пароль (без API-ключа); сторінка файлу і налаштування — як реалізовано.
- `docs/design/design-system.md`: нових примітивів у `shared/ui` немає; у розділ про утиліти (або в кінець) додати `useCountdown` і `formatDuration` з `shared/lib` одним реченням кожну, і `STATUS_TONE` як єдине джерело кольору статусу задачі.
- Специфікація 5c.4: розділ «Відхилення під час реалізації» з трьома пунктами з шапки плану (плитка в `pages/library`, `LanguageSwitch` у `features/language`, `name` у `POST /v1/uploads`) плюс усе, що змінилося під час виконання задач (з `progress.md`).
- План: відмітити виконані кроки `- [x]`.

- [ ] **Step 3: повна перевірка**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm depcruise \
  && pnpm test && pnpm test:web && pnpm test:int && pnpm build
```

Усе зелене. `pnpm test:int` потребує Docker (testcontainers) — запускати з дозволом на Docker.

Під навантаженням, як CI: `for i in 1 2 3 4; do (CI=true pnpm test:web >/tmp/web-$i.log 2>&1; echo "run $i: $?") & done; wait` → усі `0`.

- [ ] **Step 4: перевірка в compose через браузер**

```bash
pnpm stack:up
```

`.superpowers/sdd/pw/screens.mjs` — сценарій на `playwright-core` (як `check.mjs` з 5c.3; запуск `node .superpowers/sdd/pw/screens.mjs`, `BASE = 'http://localhost:18090'`), кожен крок — `check(name, ok)`:

1. `/register`: випадковий email, пароль ≥ 8 → потрапили на `/library`, порожній стан.
2. Завантаження PNG (з `pngImage` або згенерованого буфера більшого за 1×1, щоб resize мав що робити) і короткого MP4 (якщо в репозиторії є тестове відео — `rg --files -g '*.mp4'`; якщо ні — крок з відео пропустити й записати в звіт) → локальні плитки, потім серверні; статус змінюється на «Done» без перезавантаження.
3. Фільтр «Videos» і пошук за частиною назви → URL `?kind=video&q=…`; перезавантаження зберігає фільтри.
4. Сторінка файлу: оригінал видно, вкладка «Versions» має посилання «Download …»; `fetch(downloadUrl)` у контексті сторінки дає `content-disposition` з іменем.
5. Видалення → `/library`, тост «File deleted.».
6. `/settings`: створити ключ, прочитати його з поля, `curl -s -o /dev/null -w '%{http_code}' -H "X-API-Key: $KEY" http://localhost:18090/v1/jobs` → `200`; відкликати → `401`.
7. Вихід через меню → `/login`; вхід тими самими даними → `/library`.
8. Знімки екрана 375 px і 1280 px для `/library` (з файлами), `/library/:id`, `/settings`, `/login` у `.superpowers/sdd/wf/5c4-*.png` — показати користувачу у фінальному звіті.

Якщо щось не проходить — виправити окремим комітом `fix(stage-5c.4): …` і повторити кроки 3–4.

- [ ] **Step 5: коміт документів**

```bash
git add README.md docs
git commit -m "docs(stage-5c.4): sign-in, library and settings in the docs

Co-authored-by: Cursor <cursoragent@cursor.com>"
```

Не пушити: користувач пушить сам.
