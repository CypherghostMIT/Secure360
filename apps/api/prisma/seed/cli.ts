import { existsSync } from 'node:fs';
import path from 'node:path';

/** One short line for the operator. Callers never pass a password, a hash or a connection URL. */
export type WriteLine = (line: string) => void;

export const writeStderr: WriteLine = (line) => {
  process.stderr.write(`${line}\n`);
};

/** Local development only, like prisma.config.ts: never overrides a variable that is already set. */
export function loadLocalEnv(): void {
  const localEnvFile = path.resolve(__dirname, '../../../../.env');
  if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);
}

/**
 * Error class and Prisma/PostgreSQL code only. A driver message can quote the failing row (a password hash)
 * or the connection URL, so it is never printed.
 */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? `${error.name} (${code})` : error.name;
}

/** Runs a seed CLI and sets the exit code; the seed functions themselves never exit the process. */
export function runCli(name: string, main: () => Promise<number>): void {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      writeStderr(`${name} failed: ${describeFailure(error)}`);
      process.exitCode = 1;
    },
  );
}
