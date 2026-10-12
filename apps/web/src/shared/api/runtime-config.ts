import { baseApi } from './base-api';

/** Deployment settings served by nginx as `/config.json`, so one image fits every environment. */
export type RuntimeConfig = {
  /** Grafana for traces and logs; `null` hides the links. */
  grafanaUrl: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Anything unexpected (e.g. the dev server answering with index.html) means "not configured". */
export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  const grafanaUrl = isRecord(raw) ? raw.grafanaUrl : undefined;
  return {
    grafanaUrl:
      typeof grafanaUrl === 'string' && grafanaUrl.trim() !== ''
        ? grafanaUrl.trim().replace(/\/+$/, '')
        : null,
  };
}

const runtimeConfigApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getRuntimeConfig: build.query<RuntimeConfig, void>({
      query: () => ({ url: '/config.json' }),
      transformResponse: parseRuntimeConfig,
      keepUnusedDataFor: 3600,
    }),
  }),
});

export const { useGetRuntimeConfigQuery } = runtimeConfigApi;
