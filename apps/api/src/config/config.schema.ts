import { z } from 'zod';

// Keys that may come from a Docker secret file (/run/secrets/<lowercase key>, L2 §8.6). Every other key is
// plain configuration and is read from the environment only.
export const SECRET_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'DATA_ENCRYPTION_KEY',
] as const;

const AES_256_KEY_BYTES = 32;

export const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // Number of reverse proxies in front of the API (Nginx = 1). 0 trusts no X-Forwarded-* header, so a
    // directly exposed API cannot be fooled about the client IP.
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    JWT_SECRET: z.string().min(32),
    // `openssl rand -base64 32`: AES-256-GCM needs exactly 32 bytes.
    DATA_ENCRYPTION_KEY: z
      .base64()
      .refine((value) => Buffer.from(value, 'base64').length === AES_256_KEY_BYTES),
  })
  .strict();

export type RawConfig = z.infer<typeof ConfigSchema>;

export interface AppConfig {
  readonly nodeEnv: RawConfig['NODE_ENV'];
  readonly port: number;
  readonly trustProxy: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly jwtSecret: string;
  readonly dataEncryptionKey: string;
}
