import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const state = '.wrangler/e2e';
const binary = new TextEncoder().encode('verified browser fixture attachment\n');
const hash = createHash('sha256').update(binary).digest('hex');
const fixtureFile = `${state}/fixture.txt`;
const fixtureSql = `${state}/fixture.sql`;

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['./node_modules/wrangler/bin/wrangler.js', ...args], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Wrangler exited with ${code}.`))));
  });
}

await rm(state, { recursive: true, force: true });
await mkdir(state, { recursive: true });
for (const migration of [
  'migrations/0001_initial.sql',
  'migrations/0002_slice_3a.sql',
  'migrations/0003_opportunities.sql'
]) {
  await run(['d1', 'execute', 'domain-desk', '--local', '--persist-to', state, '--file', migration]);
}
const sql = (await readFile('test/e2e/fixtures.sql', 'utf8'))
  .replaceAll('__ATTACHMENT_HASH__', hash)
  .replaceAll('__ATTACHMENT_SIZE__', String(binary.byteLength));
await writeFile(fixtureSql, sql);
await writeFile(fixtureFile, binary);
await run(['d1', 'execute', 'domain-desk', '--local', '--persist-to', state, '--file', fixtureSql]);
await run([
  'r2',
  'object',
  'put',
  `domain-desk-attachments/attachments/${hash}`,
  '--local',
  '--persist-to',
  state,
  '--file',
  fixtureFile,
  '--content-type',
  'text/plain',
  '--force'
]);
