import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));

export function loadConfig(env = process.env) {
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);

  for (const name of ['PLANNER_API_KEY', 'PLANNER_INGEST_KEY']) {
    if (!env[name] || env[name].length < 32) {
      throw new Error(`${name} must be set to at least 32 characters (try: openssl rand -hex 32)`);
    }
  }
  return {
    apiKey: env.PLANNER_API_KEY,
    ingestKey: env.PLANNER_INGEST_KEY,
    port: Number(env.PORT ?? 3001),
    databasePath: env.DATABASE_PATH ?? fileURLToPath(new URL('../../data/planner.db', import.meta.url)),
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 60),
  };
}
