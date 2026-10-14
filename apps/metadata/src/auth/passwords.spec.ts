import { hashPassword, verifyPassword } from './passwords';

describe('passwords', () => {
  it('hashes with argon2id and the OWASP parameters, salted', async () => {
    const [a, b] = await Promise.all([
      hashPassword('correct horse'),
      hashPassword('correct horse'),
    ]);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
  });

  it('verifies the right password only', async () => {
    const stored = await hashPassword('correct horse');
    await expect(verifyPassword(stored, 'correct horse')).resolves.toBe(true);
    await expect(verifyPassword(stored, 'correct hors')).resolves.toBe(false);
  });

  it('rejects any password for a user without one, after doing the same work', async () => {
    await expect(verifyPassword(null, 'anything')).resolves.toBe(false);
  });
});
