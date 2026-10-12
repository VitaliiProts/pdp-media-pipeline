import { type JobDto } from '@pdp/contracts';
import { type JobRow } from '../database/schema';

export const toJobDto = (row: JobRow): JobDto => ({
  id: row.id,
  userId: row.userId,
  type: row.type,
  class: row.class,
  status: row.status,
  priority: row.priority,
  input: row.input,
  output: row.output,
  attempts: row.attempts,
  attemptBase: row.attemptBase,
  deadReason: row.deadReason,
  lastError: row.lastError,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
});

interface Cursor {
  createdAt: Date;
  id: string;
}

export const encodeCursor = (row: Pick<JobRow, 'createdAt' | 'id'>): string =>
  Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url');

export function decodeCursor(cursor: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed as [unknown, unknown];
    if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime()) ? null : { createdAt: date, id };
  } catch {
    return null;
  }
}
