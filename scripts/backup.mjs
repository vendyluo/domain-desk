import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const mode = args.includes('--remote') ? 'remote' : args.includes('--local') ? 'local' : null;
if (!mode || (args.includes('--remote') && args.includes('--local'))) {
  throw new Error('Choose exactly one read source: --local or --remote.');
}
const outputAt = args.indexOf('--output');
const output = outputAt >= 0 ? args[outputAt + 1] : null;
if (!output || output.startsWith('-')) throw new Error('Provide --output <new-directory>.');

const target = resolve(output);
const staging = `${target}.partial-${process.pid}`;
const rootPrefix = `${staging}${sep}`;

async function run(commandArgs, capture = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['./node_modules/wrangler/bin/wrangler.js', ...commandArgs], {
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
    });
    let stdout = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolveRun(stdout) : reject(new Error(`Wrangler exited with ${code}.`))));
  });
}

function destinationFor(key) {
  const destination = resolve(staging, 'attachments', key);
  if (!destination.startsWith(rootPrefix)) throw new Error(`Unsafe R2 object key: ${key}`);
  return destination;
}

await stat(target).then(
  () => Promise.reject(new Error(`Refusing to overwrite existing backup: ${target}`)),
  () => undefined
);

try {
  await mkdir(staging, { recursive: true });
  const modeFlag = `--${mode}`;
  await run([
    'd1',
    'export',
    'domain-desk',
    modeFlag,
    '--output',
    resolve(staging, 'database.sql'),
    '--skip-confirmation'
  ]);
  const query = await run(
    [
      'd1',
      'execute',
      'domain-desk',
      modeFlag,
      '--command',
      'SELECT id,object_key,size,content_hash FROM attachments ORDER BY id',
      '--json'
    ],
    true
  );
  const rows = JSON.parse(query)[0]?.results ?? [];
  const attachments = [];

  for (const row of rows) {
    const file = destinationFor(String(row.object_key));
    await mkdir(dirname(file), { recursive: true });
    await run(['r2', 'object', 'get', `domain-desk-attachments/${row.object_key}`, modeFlag, '--file', file]);
    const bytes = await readFile(file);
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== Number(row.size) || contentHash !== row.content_hash) {
      throw new Error(`Attachment verification failed for ${row.id}.`);
    }
    attachments.push({ ...row, backup_path: `attachments/${row.object_key}`, verified: true });
  }

  const databaseBytes = (await stat(resolve(staging, 'database.sql'))).size;
  if (databaseBytes === 0) throw new Error('D1 export was empty.');
  await writeFile(
    resolve(staging, 'manifest.json'),
    `${JSON.stringify({ version: 1, source: mode, created_at: new Date().toISOString(), database: 'database.sql', attachments }, null, 2)}\n`
  );
  await rename(staging, target);
  console.log(`Verified backup created at ${target} (${attachments.length} referenced attachments).`);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
