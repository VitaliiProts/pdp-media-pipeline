import { seedUser } from './seed-user';

describe('seedUser', () => {
  it('wants an email and a password together', async () => {
    await expect(seedUser('postgres://unused', 'x', { email: 'a@example.com' })).rejects.toThrow(
      'pass --email and --password together',
    );
    await expect(seedUser('postgres://unused', 'x', { password: 'long enough' })).rejects.toThrow(
      'pass --email and --password together',
    );
  });

  it('checks the email and the password like sign-up does', async () => {
    await expect(
      seedUser('postgres://unused', 'x', { email: 'nope', password: 'long enough' }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(
      seedUser('postgres://unused', 'x', { email: 'a@example.com', password: 'short' }),
    ).rejects.toMatchObject({ name: 'ZodError' });
  });
});
