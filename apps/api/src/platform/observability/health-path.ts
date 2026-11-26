// /health/live and /health/ready (L2 Table 6), with or without the /v1 prefix: logged at debug, never rate limited.
const HEALTH_PATH = /^(?:\/v1)?\/health(?:\/|$)/;

export function isHealthPath(path: string): boolean {
  return HEALTH_PATH.test(path);
}
