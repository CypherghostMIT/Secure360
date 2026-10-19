import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig, RawConfig } from './config.schema';
import { ConfigSchema, SECRET_KEYS } from './config.schema';

export const DEFAULT_SECRETS_DIR = '/run/secrets';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export interface ConfigSources {
  readonly env?: NodeJS.ProcessEnv;
  readonly secretsDir?: string;
}

// Docker secret files usually end with a newline that is not part of the value.
function readSecretFile(secretsDir: string, key: string): string | undefined {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- key comes from the fixed SECRET_KEYS list
    return readFileSync(join(secretsDir, key.toLowerCase()), 'utf8').replace(/\r?\n$/, '');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ConfigError(`Cannot read secret file for ${key}`);
  }
}

function collectRaw(
  env: NodeJS.ProcessEnv,
  secretsDir: string,
): Record<string, string | undefined> {
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(ConfigSchema.shape)) {
    const value = env[key];
    // An empty variable (KEY= in .env) means "not set", so it is reported as missing.
    raw[key] = value === '' ? undefined : value;
  }
  for (const key of SECRET_KEYS) {
    const fromFile = readSecretFile(secretsDir, key);
    if (fromFile !== undefined && fromFile !== '') raw[key] = fromFile;
  }
  return raw;
}

// Only key names are reported: Zod messages and inputs could echo a secret value into the logs.
function describeFailure(raw: Record<string, string | undefined>, keys: string[]): string {
  const unique = [...new Set(keys)].sort();
  const missing = unique.filter((key) => raw[key] === undefined);
  const invalid = unique.filter((key) => raw[key] !== undefined);
  const parts = [];
  if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
  if (invalid.length > 0) parts.push(`invalid: ${invalid.join(', ')}`);
  return `Invalid configuration (${parts.join('; ')})`;
}

function toAppConfig(parsed: RawConfig): AppConfig {
  return Object.freeze({
    nodeEnv: parsed.NODE_ENV,
    port: parsed.API_PORT,
    trustProxy: parsed.TRUST_PROXY,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    jwtSecret: parsed.JWT_SECRET,
    dataEncryptionKey: parsed.DATA_ENCRYPTION_KEY,
  });
}

/** Reads and validates the configuration. Called once by the entry point; throws ConfigError on failure. */
export function loadConfig(sources: ConfigSources = {}): AppConfig {
  const raw = collectRaw(sources.env ?? process.env, sources.secretsDir ?? DEFAULT_SECRETS_DIR);
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const keys = result.error.issues.map((issue) => String(issue.path[0]));
    throw new ConfigError(describeFailure(raw, keys));
  }
  return toAppConfig(result.data);
}
