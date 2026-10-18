import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import { REFIT_FORMAT, REFIT_SYSTEM, TRANSLATE_SYSTEM, TRANSLATION_FORMAT } from './openai.prompts';
import { parseRetryAfter, ProviderError } from './provider-error';
import {
  type RefitRequest,
  type SpeechToText,
  type TokenUsage,
  type Transcript,
  type TranslationRequest,
  type Translation,
  type Translator,
} from './types';

const PROVIDER = 'openai';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const STT_MODEL = 'gpt-4o-transcribe-diarize';

export interface OpenAiOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

class OpenAiHttp {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: OpenAiOptions) {
    this.baseUrl = options.baseUrl ?? OPENAI_BASE_URL;
    this.fetch = options.fetch ?? fetch;
  }

  /** A shutdown (`signal`) aborts as it is, so the runner hands the job back. */
  async post(
    path: string,
    body: FormData | object,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const isForm = body instanceof FormData;
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          ...(!isForm && { 'content-type': 'application/json' }),
        },
        body: isForm ? body : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (timeout.aborted)
        throw new ProviderError(PROVIDER, `${path} timed out after ${timeoutMs} ms`);
      throw new ProviderError(PROVIDER, `${path} failed: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(PROVIDER, `${path} ${res.status}: ${text.slice(0, 300)}`, {
        status: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
      });
    }
    return res.json();
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ProviderError(PROVIDER, `unexpected ${what}: ${result.error.message}`);
  return result.data;
}

const DiarizedResponse = z.object({
  segments: z.array(
    z.object({ start: z.number(), end: z.number(), text: z.string(), speaker: z.string() }),
  ),
});

export class OpenAiSpeechToText implements SpeechToText {
  readonly name = STT_MODEL;
  private readonly http: OpenAiHttp;

  constructor(private readonly options: OpenAiOptions & { timeoutMs: number }) {
    this.http = new OpenAiHttp(options);
  }

  async transcribe(
    audio: { path: string; durationSeconds: number },
    signal?: AbortSignal,
  ): Promise<Transcript> {
    const form = new FormData();
    form.set(
      'file',
      new Blob([await readFile(audio.path)], { type: 'audio/flac' }),
      basename(audio.path),
    );
    form.set('model', STT_MODEL);
    form.set('response_format', 'diarized_json');
    form.set('chunking_strategy', 'auto');
    const body = parse(
      DiarizedResponse,
      await this.http.post('/audio/transcriptions', form, this.options.timeoutMs, signal),
      'transcription',
    );
    const segments = body.segments
      .map((s) => ({ ...s, text: s.text.trim() }))
      .filter((s) => s.text)
      .map((s, i) => ({
        id: String(i + 1),
        start: s.start,
        end: s.end,
        text: s.text,
        speaker: s.speaker,
      }));
    // Billed by the length of the audio sent, speech or not.
    return { segments, billedSeconds: audio.durationSeconds };
  }
}

const Completion = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

const TranslationContent = z.object({
  sourceLanguage: z.string(),
  segments: z.array(z.object({ id: z.string(), variants: z.array(z.string()) })),
});
const RefitContent = z.object({ variants: z.array(z.string()) });

const phrasings = (variants: string[]) => variants.map((v) => v.trim()).filter(Boolean);

export class OpenAiTranslator implements Translator {
  readonly name: string;
  private readonly http: OpenAiHttp;

  constructor(
    private readonly options: OpenAiOptions & {
      model: string;
      reasoningEffort: ReasoningEffort;
      translateTimeoutMs: number;
      refitTimeoutMs: number;
    },
  ) {
    this.name = options.model;
    this.http = new OpenAiHttp(options);
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<Translation> {
    const { content, usage } = await this.complete(
      TRANSLATE_SYSTEM,
      {
        targetLanguage: request.targetLanguage,
        sourceLanguage: request.sourceLanguage,
        segments: request.lines,
      },
      TRANSLATION_FORMAT,
      this.options.translateTimeoutMs,
      signal,
    );
    const result = parse(TranslationContent, content, 'translation');
    const byId = new Map(result.segments.map((s) => [s.id, phrasings(s.variants)]));
    const lines = request.lines.map(({ id }) => ({ id, variants: byId.get(id) ?? [] }));
    if (result.segments.length !== lines.length || lines.some((l) => l.variants.length === 0)) {
      throw new ProviderError(PROVIDER, 'translation does not phrase every line exactly once');
    }
    return { sourceLanguage: result.sourceLanguage.toLowerCase(), lines, usage };
  }

  async refit(
    request: RefitRequest,
    signal?: AbortSignal,
  ): Promise<{ variants: string[]; usage: TokenUsage }> {
    const { content, usage } = await this.complete(
      REFIT_SYSTEM,
      request,
      REFIT_FORMAT,
      this.options.refitTimeoutMs,
      signal,
    );
    return { variants: phrasings(parse(RefitContent, content, 'refit').variants), usage };
  }

  private async complete(
    system: string,
    user: object,
    responseFormat: object,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ content: unknown; usage: TokenUsage }> {
    const body = parse(
      Completion,
      await this.http.post(
        '/chat/completions',
        {
          model: this.options.model,
          reasoning_effort: this.options.reasoningEffort,
          response_format: responseFormat,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(user) },
          ],
        },
        timeoutMs,
        signal,
      ),
      'completion',
    );
    const [choice] = body.choices;
    if (choice?.message.refusal) {
      throw new ProviderError(PROVIDER, `the model refused: ${choice.message.refusal}`, {
        permanent: true,
      });
    }
    if (!choice?.message.content || choice.finish_reason === 'length') {
      throw new ProviderError(PROVIDER, `incomplete answer (${choice?.finish_reason ?? 'none'})`);
    }
    let content: unknown;
    try {
      content = JSON.parse(choice.message.content);
    } catch {
      throw new ProviderError(PROVIDER, 'the answer is not JSON');
    }
    return {
      content,
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      },
    };
  }
}
