import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { ConfigError, loadConfig } from '../src/config';
import { aadFor, decrypt, encrypt } from '../src/platform/crypto/aes-gcm';
import { captureLogger } from './helpers/log-capture';
import { keyringEntry } from './helpers/keys';

// Values are generated per run so no secret-looking literal lives in the repository.
const urlPassword = (): string => randomBytes(24).toString('hex');

function validEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: `postgresql://app:${urlPassword()}@127.0.0.1:5432/secure360`,
    REDIS_URL: `redis://:${urlPassword()}@127.0.0.1:6379`,
    JWT_SECRET: randomBytes(48).toString('base64'),
    DATA_ENCRYPTION_KEYS: keyringEntry(1),
    DATA_ENCRYPTION_ACTIVE_KEY_ID: '1',
    RATE_LIMIT_HMAC_KEY: randomBytes(32).toString('base64'),
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
      loadConfig({ env: { ...validEnv(), DATA_ENCRYPTION_KEYS: `1:${shortKey}` }, secretsDir }),
    );

    expect(error.message).toContain('invalid: DATA_ENCRYPTION_KEYS');
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

  it.each([
    ['development', 'debug'],
    ['test', 'info'],
    ['production', 'info'],
  ] as const)('defaults LOG_LEVEL for %s to %s', (nodeEnv, level) => {
    expect(loadConfig({ env: { ...validEnv(), NODE_ENV: nodeEnv }, secretsDir }).logLevel).toBe(
      level,
    );
  });

  it('reads an explicit LOG_LEVEL', () => {
    const env = { ...validEnv(), NODE_ENV: 'production', LOG_LEVEL: 'warn' };
    expect(loadConfig({ env, secretsDir }).logLevel).toBe('warn');
  });

  it('rejects an unknown LOG_LEVEL', () => {
    const error = captureError(() =>
      loadConfig({ env: { ...validEnv(), LOG_LEVEL: 'verbose' }, secretsDir }),
    );

    expect(error.message).toContain('invalid: LOG_LEVEL');
  });

  it('never reads LOG_LEVEL from a secret file', () => {
    writeSecret('log_level', 'trace');

    expect(loadConfig({ env: validEnv(), secretsDir }).logLevel).toBe('debug');
  });
});

describe('loadConfig: encryption and HMAC keys', () => {
  const bytesOf = (base64: string | undefined) => Buffer.from(base64 ?? '', 'base64');

  it.each(['DATA_ENCRYPTION_KEYS', 'DATA_ENCRYPTION_ACTIVE_KEY_ID', 'RATE_LIMIT_HMAC_KEY'])(
    'fails to boot when %s is missing',
    (key) => {
      const env: NodeJS.ProcessEnv = { ...validEnv(), [key]: undefined };
      expect(captureError(() => loadConfig({ env, secretsDir })).message).toBe(
        `Invalid configuration (missing: ${key})`,
      );
    },
  );

  it.each([
    ['a 31-byte data key', { DATA_ENCRYPTION_KEYS: keyringEntry(1, randomBytes(31)) }],
    ['a 33-byte data key', { DATA_ENCRYPTION_KEYS: keyringEntry(1, randomBytes(33)) }],
    ['a malformed second data key', { DATA_ENCRYPTION_KEYS: `${keyringEntry(1)}\n2:short` }],
  ])('fails to boot with %s, without echoing it', (_label, override) => {
    const env = { ...validEnv(), ...override };
    const error = captureError(() => loadConfig({ env, secretsDir }));

    expect(error.message).toBe('Invalid configuration (invalid: DATA_ENCRYPTION_KEYS)');
    for (const part of override.DATA_ENCRYPTION_KEYS.split(/[:\n]/)) {
      expect(error.message).not.toContain(part);
    }
  });

  it('fails to boot with a 31-byte HMAC key, without echoing it', () => {
    const short = randomBytes(31).toString('base64');
    const error = captureError(() =>
      loadConfig({ env: { ...validEnv(), RATE_LIMIT_HMAC_KEY: short }, secretsDir }),
    );

    expect(error.message).toBe('Invalid configuration (invalid: RATE_LIMIT_HMAC_KEY)');
    expect(error.message).not.toContain(short);
  });

  it('accepts an HMAC key longer than 32 bytes', () => {
    const env = { ...validEnv(), RATE_LIMIT_HMAC_KEY: randomBytes(48).toString('base64') };
    expect(loadConfig({ env, secretsDir }).rateLimitHmacKey.symmetricKeySize).toBe(48);
  });

  it('fails to boot when the active key id is not in the ring', () => {
    const env = { ...validEnv(), DATA_ENCRYPTION_ACTIVE_KEY_ID: '2' };
    expect(captureError(() => loadConfig({ env, secretsDir })).message).toBe(
      'Invalid configuration (invalid: DATA_ENCRYPTION_ACTIVE_KEY_ID)',
    );
  });

  // Id 2 is in the ring, so these fail only because of their form, not because the key is missing.
  it.each(['0x2', '2e0', ' 2 ', '+2', '02', '0', '65536'])(
    'rejects the active key id %p',
    (activeKeyId) => {
      const env = {
        ...validEnv(),
        DATA_ENCRYPTION_KEYS: `${keyringEntry(1)},${keyringEntry(2)}`,
        DATA_ENCRYPTION_ACTIVE_KEY_ID: activeKeyId,
      };
      expect(captureError(() => loadConfig({ env, secretsDir })).message).toBe(
        'Invalid configuration (invalid: DATA_ENCRYPTION_ACTIVE_KEY_ID)',
      );
    },
  );

  it('accepts the largest active key id', () => {
    const env = {
      ...validEnv(),
      DATA_ENCRYPTION_KEYS: keyringEntry(65535),
      DATA_ENCRYPTION_ACTIVE_KEY_ID: '65535',
    };
    expect(loadConfig({ env, secretsDir }).dataEncryption.activeKeyId).toBe(65535);
  });

  it('reads a multi-line keyring from its secret file and uses the active id', () => {
    const oldBytes = randomBytes(32);
    const newBytes = randomBytes(32);
    writeSecret(
      'data_encryption_keys',
      `${keyringEntry(1, Buffer.from(oldBytes))}\n${keyringEntry(2, Buffer.from(newBytes))}\n`,
    );
    const env = {
      ...validEnv(),
      DATA_ENCRYPTION_KEYS: undefined,
      DATA_ENCRYPTION_ACTIVE_KEY_ID: '2',
    };

    const { dataEncryption } = loadConfig({ env, secretsDir });

    expect(dataEncryption.activeKeyId).toBe(2);
    expect(dataEncryption.keyFor(1)?.export().equals(oldBytes)).toBe(true);
    expect(dataEncryption.keyFor(2)?.export().equals(newBytes)).toBe(true);
    expect(dataEncryption.keyFor(3)).toBeUndefined();
    const aad = aadFor('users.totp_secret', 'user-1');
    const blob = encrypt(dataEncryption, Buffer.from('x'), aad);
    expect(decrypt(dataEncryption, blob, aad).toString()).toBe('x');
  });

  it('holds the HMAC key as a KeyObject with the configured bytes', () => {
    const env = validEnv();
    const { rateLimitHmacKey } = loadConfig({ env, secretsDir });
    const expected = createHmac('sha256', bytesOf(env['RATE_LIMIT_HMAC_KEY']))
      .update('a')
      .digest('hex');

    expect(rateLimitHmacKey.type).toBe('secret');
    expect(createHmac('sha256', rateLimitHmacKey).update('a').digest('hex')).toBe(expected);
  });

  it('shows no key material through util.inspect, JSON.stringify or the logger', () => {
    const env: NodeJS.ProcessEnv = {
      ...validEnv(),
      DATA_ENCRYPTION_KEYS: `${keyringEntry(1)}\n${keyringEntry(2)}`,
    };
    const config = loadConfig({ env, secretsDir });
    const { logger, raw } = captureLogger();
    logger.info(config, 'config.loaded');
    logger.info({ config }, 'config.loaded');
    logger.info({ app: { config } }, 'config.loaded');

    const shown = [inspect(config, { depth: 10, showHidden: true }), JSON.stringify(config), raw()];
    const keyTexts = [
      ...(env['DATA_ENCRYPTION_KEYS'] ?? '').split('\n').map((entry) => entry.slice(2)),
      env['RATE_LIMIT_HMAC_KEY'] ?? '',
    ];
    for (const keyText of keyTexts) {
      const bytes = bytesOf(keyText);
      for (const text of shown) {
        expect(text).not.toContain(keyText);
        expect(text).not.toContain(bytes.toString('base64url'));
        expect(text).not.toContain(bytes.toString('hex'));
      }
    }
    const secretTexts = [
      env['JWT_SECRET'] ?? '',
      new URL(env['DATABASE_URL'] ?? '').password,
      new URL(env['REDIS_URL'] ?? '').password,
    ];
    for (const secret of secretTexts) {
      expect(secret).not.toBe('');
      for (const text of shown) expect(text).not.toContain(secret);
    }
  });

  it('redacts secret fields in JSON and inspect output but keeps the real values readable', () => {
    const env = validEnv();
    const config = loadConfig({ env, secretsDir });
    const json = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;

    for (const field of ['jwtSecret', 'databaseUrl', 'redisUrl'] as const) {
      expect(json[field]).toBe('[REDACTED]');
      expect(inspect(config)).toContain(`${field}: '[REDACTED]'`);
    }
    expect(json['port']).toBe(3000);
    expect(config.jwtSecret).toBe(env['JWT_SECRET']);
    expect(config.databaseUrl).toBe(env['DATABASE_URL']);
    expect(Object.keys(config)).not.toContain('toJSON');
  });
});
