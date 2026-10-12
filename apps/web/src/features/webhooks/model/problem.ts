import { type SerializedError } from '@reduxjs/toolkit';
import { type AppError } from '../../../shared/api/http';

type ProblemKey =
  | 'problem.network'
  | 'problem.busy'
  | 'problem.limit'
  | 'problem.notFound'
  | 'problem.invalid'
  | 'problem.unknown';

export type WebhookProblem = { key: ProblemKey; detail: string | null };

/** Turns a failed request into a translation key, keeping the gateway's reason for 400s. */
export function problemOf(error: AppError | SerializedError | undefined): WebhookProblem | null {
  if (!error) return null;
  if (!('kind' in error)) return { key: 'problem.unknown', detail: null };
  switch (error.kind) {
    case 'network':
      return { key: 'problem.network', detail: null };
    case 'retryLater':
      return { key: 'problem.busy', detail: null };
    case 'http':
      if (error.status === 409) return { key: 'problem.limit', detail: null };
      if (error.status === 404) return { key: 'problem.notFound', detail: null };
      if (error.status === 400) return { key: 'problem.invalid', detail: error.message };
      return { key: 'problem.unknown', detail: null };
    default:
      return { key: 'problem.unknown', detail: null };
  }
}
