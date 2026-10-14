import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

/**
 * argon2id with the first OWASP configuration: 19 MiB, 2 passes, 1 lane (ADR-013).
 * The parameters are part of every stored hash, so raising them later only affects
 * new hashes; old ones still verify.
 */
export const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON2_OPTIONS);

let dummyHash: Promise<string> | undefined;

/**
 * Verifies against `stored`, or against a throwaway hash when there is no such user, so an
 * unknown email costs the same time as a wrong password and cannot be told apart by latency.
 */
export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  if (stored) return verify(stored, password);
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verify(await dummyHash, password);
  return false;
}
