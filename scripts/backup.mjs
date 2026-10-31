import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
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
const persistAt = args.indexOf('--persist-to');
const persist = persistAt >= 0 ? args[persistAt + 1] : null;
if (persistAt >= 0 && (mode !== 'local' || !persist || persist.startsWith('-')))
  throw new Error('--persist-to <directory> requires --local.');
const source = [`--${mode}`, ...(persist ? ['--persist-to', resolve(persist)] : [])];

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

async function sqlite(database, sql, raw = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('sqlite3', [...(raw ? [] : ['-json']), database, sql], {
      stdio: ['ignore', 'pipe', 'inherit']
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolveRun(raw ? stdout : JSON.parse(stdout || '[]'))
        : reject(new Error(`sqlite3 exited with ${code}.`))
    );
  });
}

function destinationFor(key) {
  if (!key || key.startsWith('/') || key.includes('\\') || key.split('/').some((part) => part === '..' || part === '.'))
    throw new Error(`Unsafe R2 object key: ${key}`);
  const destination = resolve(staging, 'attachments', key);
  if (!destination.startsWith(rootPrefix)) throw new Error(`Unsafe R2 object key: ${key}`);
  return destination;
}

await lstat(target).then(
  () => Promise.reject(new Error(`Refusing to overwrite existing backup: ${target}`)),
  (error) => (error.code === 'ENOENT' ? undefined : Promise.reject(error))
);

let created = false;
try {
  await mkdir(dirname(staging), { recursive: true });
  await mkdir(staging, { mode: 0o700 });
  created = true;
  // d1 export lacks execute's --persist-to flag. Its default is relative to
  // --config, so isolate a temporary config/state link instead of touching the
  // project's default state or silently exporting the wrong database.
  let exportSource = source;
  const exportWorkspace = resolve(staging, '.export');
  if (persist) {
    await lstat(resolve(persist, 'v3/d1'));
    await mkdir(resolve(exportWorkspace, '.wrangler'), { recursive: true });
    await writeFile(resolve(exportWorkspace, 'wrangler.toml'), await readFile('wrangler.toml'));
    await symlink(resolve(persist), resolve(exportWorkspace, '.wrangler/state'), 'dir');
    exportSource = ['--local', '--config', resolve(exportWorkspace, 'wrangler.toml')];
  }
  await run([
    'd1',
    'export',
    'domain-desk',
    ...exportSource,
    '--output',
    resolve(staging, 'database.sql'),
    '--skip-confirmation'
  ]);
  if (persist) await rm(exportWorkspace, { recursive: true, force: true });
  // Read attachment references from the exported database, not a second live query.
  // This makes the SQL graph and object manifest one coherent snapshot boundary.
  const inspection = resolve(staging, '.inspection.sqlite');
  await new Promise((resolveRun, reject) => {
    const child = spawn('sqlite3', [inspection], { stdio: ['pipe', 'inherit', 'inherit'] });
    readFile(resolve(staging, 'database.sql')).then((sql) => child.stdin.end(sql), reject);
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolveRun() : reject(new Error(`sqlite3 import exited with ${code}.`))));
  });
  const integrity = await sqlite(inspection, 'PRAGMA integrity_check;');
  if (integrity[0]?.integrity_check !== 'ok') throw new Error('Exported database failed integrity_check.');
  if ((await sqlite(inspection, 'PRAGMA foreign_key_check;')).length)
    throw new Error('Exported database failed foreign_key_check.');
  const rows = await sqlite(inspection, 'SELECT id,object_key,size,content_hash FROM attachments ORDER BY id;');
  // Wrangler interleaves CREATE/INSERT per table. D1's always-on foreign keys
  // reject inserts referencing tables not yet created, even with deferred checks
  // (next_actions references the later opportunities table). Emit all tables first,
  // then data, then indexes/triggers, without parsing SQL or changing row values.
  const schema = await sqlite(
    inspection,
    "SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid;"
  );
  const tables = schema
    .filter((row) => row.type === 'table')
    .map((row) => `${row.sql};`)
    .join('\n');
  const remaining = schema
    .filter((row) => row.type !== 'table')
    .map((row) => `${row.sql};`)
    .join('\n');
  // Recent sqlite3 .dump emits unistr(), which D1 does not support. Encode TEXT
  // as UTF-8 hex instead, preserving newlines, control characters and embedded NUL.
  const identifier = (name) => `"${name.replaceAll('"', '""')}"`;
  let data = '';
  for (const table of schema.filter((row) => row.type === 'table')) {
    const name = identifier(table.name);
    const columns = await sqlite(inspection, `PRAGMA table_info(${name});`);
    const values = columns.map(({ name: column }) => {
      const field = identifier(column);
      return `CASE WHEN typeof(${field})='text' THEN 'CAST(X''' || hex(${field}) || ''' AS TEXT)' ELSE quote(${field}) END`;
    });
    const prefix = `INSERT INTO ${name} VALUES(`.replaceAll("'", "''");
    data += await sqlite(inspection, `SELECT '${prefix}' || ${values.join(" || ',' || ")} || ');' FROM ${name};`, true);
  }
  await writeFile(
    resolve(staging, 'database.sql'),
    `PRAGMA defer_foreign_keys=ON;\n${tables}\n${data}\n${remaining}\n`
  );
  await rm(inspection, { force: true });
  const attachments = [];

  for (const row of rows) {
    const file = destinationFor(String(row.object_key));
    await mkdir(dirname(file), { recursive: true });
    await run(['r2', 'object', 'get', `domain-desk-attachments/${row.object_key}`, ...source, '--file', file]);
    const bytes = await readFile(file);
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== Number(row.size) || contentHash !== row.content_hash) {
      throw new Error(`Attachment verification failed for ${row.id}.`);
    }
    attachments.push({ ...row, backup_path: `attachments/${row.object_key}`, verified: true });
  }

  const databaseFile = resolve(staging, 'database.sql');
  const database = await readFile(databaseFile);
  const databaseBytes = database.byteLength;
  if (databaseBytes === 0) throw new Error('D1 export was empty.');
  const databaseHash = createHash('sha256').update(database).digest('hex');
  await writeFile(
    resolve(staging, 'manifest.json'),
    `${JSON.stringify({ version: 2, source: mode, created_at: new Date().toISOString(), database: { backup_path: 'database.sql', size: databaseBytes, content_hash: databaseHash }, attachments }, null, 2)}\n`
  );
  await rename(staging, target);
  console.log(`Verified backup created at ${target} (${attachments.length} referenced attachments).`);
} catch (error) {
  if (created) await rm(staging, { recursive: true, force: true });
  throw error;
}
