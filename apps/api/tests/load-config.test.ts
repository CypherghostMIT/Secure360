import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, loadConfig } from '../src/config';

// Values are generated per run so no secret-looking literal lives in the repository.
function validEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://app@127.0.0.1:5432/secure360',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_SECRET: randomBytes(48).toString('base64'),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
}

let secretsDir: string;
beforeEach(() => {
  secretsDir = mkdtempSync(join(tmpdir(), 's360-secrets-'));
});
afterEach(() => {
  rmSync(secretsDir, { recursive: true, force: true });
});

function writeSecret(name: string, value: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed names inside a fresh temp dir
  writeFileSync(join(secretsDir, name), value);
}

function captureError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('loads a valid environment and applies defaults', () => {
    const config = loadConfig({ env: validEnv(), secretsDir });

    expect(config.port).toBe(3000);
    expect(config.trustProxy).toBe(0);
    expect(config.nodeEnv).toBe('development');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('reads API_PORT', () => {
    expect(loadConfig({ env: { ...validEnv(), API_PORT: '4100' }, secretsDir }).port).toBe(4100);
  });

  it('names every missing key and never prints a value', () => {
    const env = validEnv();
    const { JWT_SECRET: _omitted, ...rest } = env;
    const error = captureError(() => loadConfig({ env: { ...rest, REDIS_URL: '' }, secretsDir }));

    expect(error.message).toContain('missing: JWT_SECRET, REDIS_URL');
    for (const value of Object.values(rest)) expect(error.message).not.toContain(value);
  });

  it('names an invalid key without echoing its value', () => {
    const shortKey = randomBytes(16).toString('base64');
    const error = captureError(() =>
      loadConfig({ env: { ...validEnv(), DATA_ENCRYPTION_KEY: shortKey }, secretsDir }),
    );

    expect(error.message).toContain('invalid: DATA_ENCRYPTION_KEY');
    expect(error.message).not.toContain(shortKey);
  });

  it('rejects a non-numeric API_PORT', () => {
    const error = captureError(() =>
      loadConfig({ env: { ...validEnv(), API_PORT: 'abc' }, secretsDir }),
    );

    expect(error.message).toContain('invalid: API_PORT');
  });

  it('prefers a secret file over the environment', () => {
    const fromFile = randomBytes(48).toString('base64');
    writeSecret('jwt_secret', `${fromFile}\n`);

    const config = loadConfig({ env: validEnv(), secretsDir });

    expect(config.jwtSecret).toBe(fromFile);
  });

  it('satisfies a key missing from the environment with its secret file', () => {
    const { DATABASE_URL: url, ...rest } = validEnv();
    writeSecret('database_url', url ?? '');

    expect(loadConfig({ env: rest, secretsDir }).databaseUrl).toBe(url);
  });

  it('never reads non-secret keys from files', () => {
    writeSecret('api_port', '9999');

    expect(loadConfig({ env: validEnv(), secretsDir }).port).toBe(3000);
  });
});
