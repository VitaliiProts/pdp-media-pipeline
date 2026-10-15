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
