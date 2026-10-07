import { type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { z } from 'zod';

export function validateEnv<S extends z.ZodType>(schema: S) {
  return (env: Record<string, unknown>): z.infer<S> => {
    const result = schema.safeParse(env);
    if (!result.success) {
      throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
    }
    return result.data;
  };
}

/**
 * Global, cached ConfigModule that fails fast on startup when env does not match the schema.
 * Read values through `ConfigService<Env, true>` with `{ infer: true }`.
 */
export function createConfigModule(schema: z.ZodObject): Promise<DynamicModule> {
  return ConfigModule.forRoot({
    isGlobal: true,
    cache: true,
    ignoreEnvFile: process.env.NODE_ENV === 'production',
    validate: validateEnv(schema),
  });
}
