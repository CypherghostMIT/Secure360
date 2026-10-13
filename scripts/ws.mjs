// Run an npm script in every workspace that defines it.
// Unlike "npm run x --workspaces", this does not fail while apps/ and packages/ are still empty.
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = process.argv[2];
if (!script) {
  process.stderr.write('usage: node scripts/ws.mjs <script>\n');
  process.exit(2);
}
const workspaces = ['apps', 'packages']
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => readdirSync(dir).map((name) => join(dir, name)))
  .filter((dir) => existsSync(join(dir, 'package.json')))
  .filter((dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts?.[script]);

if (workspaces.length === 0) {
  process.stdout.write(`No workspace defines "${script}" yet — skipped.\n`);
  process.exit(0);
}
for (const ws of workspaces) {
  process.stdout.write(`\n▶ ${ws}: npm run ${script}\n`);
  const result = spawnSync('npm', ['run', script, '--workspace', ws], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
