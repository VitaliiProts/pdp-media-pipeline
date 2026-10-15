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
