import { apiKeyPrefix, generateApiKey, hashApiKey } from '@pdp/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { auditLog, users } from './database/schema';

/**
 * Creates a user and prints its API key once; only the hash is stored.
 * `--api-key` sets a known key (local dev, tests); otherwise one is generated.
 */
export async function seedUser(
  databaseUrl: string,
  name: string,
  apiKey = generateApiKey(),
): Promise<{ userId: string; apiKey: string }> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool);
    const userId = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ name, apiKeyHash: hashApiKey(apiKey), apiKeyPrefix: apiKeyPrefix(apiKey) })
        .returning({ id: users.id });
      if (!user) throw new Error('insert returned no row');
      await tx
        .insert(auditLog)
        .values({ actor: 'cli', action: 'user.created', entityId: user.id, data: { name } });
      return user.id;
    });
    return { userId, apiKey };
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const { values } = parseArgs({
    options: { name: { type: 'string', default: 'dev' }, 'api-key': { type: 'string' } },
  });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  seedUser(url, values.name, values['api-key']).then(
    (result) => console.log(JSON.stringify(result)),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
