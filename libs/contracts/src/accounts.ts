import { z } from 'zod';

/** OWASP: at least 8 characters, no composition rules, and room for long passphrases. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;
export const USER_NAME_MAX_LENGTH = 100;
export const API_KEY_NAME_MAX_LENGTH = 100;
export const API_KEY_MAX_PER_USER = 10;
export const SESSION_COOKIE = 'pdp_session';

/** Stored and compared in lower case: one account per mailbox whatever the client typed. */
export const EmailSchema = z
  .string()
  .trim()
  .max(EMAIL_MAX_LENGTH)
  .pipe(z.email())
  .transform((email) => email.toLowerCase());

export const PasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const UserDto = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Null for users created with an API key only (`seed:user`). */
  email: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type UserDto = z.infer<typeof UserDto>;

export const RegisterRequest = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z.string().trim().min(1).max(USER_NAME_MAX_LENGTH).optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

/** Only the length is checked: a login must not reveal the current password rules. */
export const LoginRequest = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const ApiKeyDto = z.object({
  id: z.uuid(),
  name: z.string(),
  /** First characters of the key, enough to tell keys apart in a list. */
  prefix: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type ApiKeyDto = z.infer<typeof ApiKeyDto>;

/** The plain key exists only in this response; Metadata keeps the hash. */
export const CreatedApiKeyDto = ApiKeyDto.extend({ key: z.string() });
export type CreatedApiKeyDto = z.infer<typeof CreatedApiKeyDto>;

export const CreateApiKeyRequest = z.object({
  userId: z.uuid(),
  name: z.string().trim().min(1).max(API_KEY_NAME_MAX_LENGTH),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequest>;

export const ListApiKeysResponse = z.object({ items: z.array(ApiKeyDto) });
export type ListApiKeysResponse = z.infer<typeof ListApiKeysResponse>;
