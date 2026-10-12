/** Client-chosen key that makes `POST /v1/jobs` safe to retry. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
/** Set on a response that replays the one stored for the Idempotency-Key. */
export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';

export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;
