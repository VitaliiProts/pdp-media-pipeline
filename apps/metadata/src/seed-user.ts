import {
  apiKeyPrefix,
  EmailSchema,
  generateApiKey,
  hashApiKey,
  PasswordSchema,
} from '@pdp/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { hashPassword } from './auth/passwords';
import { apiKeys, auditLog, users } from './database/schema';

export interface SeedUserOptions {
  /** A known key for local dev and tests; otherwise one is generated. */
  apiKey?: string;
  email?: string;
  password?: string;
}

/**
 * Creates a user and prints its API key once; only hashes are stored. With `--email` and
 * `--password` the user can also sign in to the web app.
 */
export async function seedUser(
  databaseUrl: string,
  name: string,
  { apiKey = generateApiKey(), email, password }: SeedUserOptions = {},
): Promise<{ userId: string; apiKey: string; email: string | null }> {
  if ((email === undefined) !== (password === undefined)) {
    throw new Error('seed-user: pass --email and --password together');
  }
  const normalizedEmail = email === undefined ? null : EmailSchema.parse(email);
  const passwordHash =
    password === undefined ? null : await hashPassword(PasswordSchema.parse(password));

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool);
    const userId = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ name, email: normalizedEmail, passwordHash })
        .returning({ id: users.id });
      if (!user) throw new Error('insert returned no row');
      await tx.insert(apiKeys).values({
        userId: user.id,
        name: 'default',
        hash: hashApiKey(apiKey),
        prefix: apiKeyPrefix(apiKey),
      });
      await tx
        .insert(auditLog)
        .values({ actor: 'cli', action: 'user.created', entityId: user.id, data: { name } });
      return user.id;
    });
    return { userId, apiKey, email: normalizedEmail };
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const { values } = parseArgs({
    options: {
      name: { type: 'string', default: 'dev' },
      'api-key': { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
    },
  });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  seedUser(url, values.name, {
    apiKey: values['api-key'],
    email: values.email,
    password: values.password,
  }).then(
    (result) => console.log(JSON.stringify(result)),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
