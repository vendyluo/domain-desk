import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function command(program, args, input) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(program, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolveRun(output) : reject(new Error(`${program} exited with ${code}.`))
    );
    if (input) child.stdin.end(input);
  });
}

export async function verifyBackup(directory) {
  const root = resolve(directory);
  const rootReal = await realpath(root);
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  if (manifest.version !== 2 || !manifest.database || !Array.isArray(manifest.attachments))
    throw new Error('Unsupported or malformed backup manifest.');

  const checkedPath = async (relative) => {
    if (typeof relative !== 'string' || !relative || relative.includes('\\')) throw new Error('Unsafe backup path.');
    const file = resolve(root, relative);
    if (!file.startsWith(`${root}${sep}`)) throw new Error(`Unsafe backup path: ${relative}`);
    const actual = await realpath(file);
    if (!actual.startsWith(`${rootReal}${sep}`)) throw new Error(`Backup path escapes through a link: ${relative}`);
    return file;
  };
  const verifyFile = async (record) => {
    if (!Number.isSafeInteger(record.size) || record.size < 0 || !isHash(record.content_hash))
      throw new Error('Malformed size or hash in manifest.');
    const file = await checkedPath(record.backup_path);
    const bytes = await readFile(file);
    if (bytes.byteLength !== record.size || sha256(bytes) !== record.content_hash)
      throw new Error(`Hash/size verification failed: ${record.backup_path}`);
    return { file, bytes };
  };

  const database = await verifyFile(manifest.database);
  const keys = new Set();
  for (const item of manifest.attachments) {
    if (
      typeof item.id !== 'string' ||
      typeof item.object_key !== 'string' ||
      !item.object_key ||
      item.object_key.startsWith('/') ||
      item.object_key.includes('\\') ||
      item.object_key.split('/').includes('..') ||
      keys.has(item.object_key)
    )
      throw new Error('Malformed or duplicate attachment entry.');
    keys.add(item.object_key);
    await verifyFile(item);
  }

  const inspection = await mkdtemp(resolve(tmpdir(), 'domain-desk-restore-check-'));
  const sqliteFile = resolve(inspection, 'database.sqlite');
  try {
    await command('sqlite3', [sqliteFile], database.bytes);
    const integrity = JSON.parse((await command('sqlite3', ['-json', sqliteFile, 'PRAGMA integrity_check;'])) || '[]');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok')
      throw new Error('Database integrity check failed.');
    const foreignKeys = JSON.parse(
      (await command('sqlite3', ['-json', sqliteFile, 'PRAGMA foreign_key_check;'])) || '[]'
    );
    if (foreignKeys.length !== 0) throw new Error('Database foreign key check failed.');
    const rows = JSON.parse(
      (await command('sqlite3', [
        '-json',
        sqliteFile,
        'SELECT id,object_key,size,content_hash FROM attachments ORDER BY id;'
      ])) || '[]'
    );
    const expected = manifest.attachments.map(({ id, object_key, size, content_hash }) => ({
      id,
      object_key,
      size,
      content_hash
    }));
    if (JSON.stringify(rows) !== JSON.stringify(expected))
      throw new Error('Manifest attachment references do not match database snapshot.');
  } finally {
    await rm(inspection, { recursive: true, force: true });
  }
  return { root, manifest, databaseFile: database.file };
}

export async function restoreLocal(directory, target) {
  const destination = resolve(target);
  await lstat(destination).then(
    () => Promise.reject(new Error(`Refusing non-fresh restore target: ${destination}`)),
    (error) => (error.code === 'ENOENT' ? undefined : Promise.reject(error))
  );
  const verified = await verifyBackup(directory); // Every check completes before the first write.
  await mkdir(destination, { mode: 0o700 }); // Atomic fresh-target claim, not recursive.
  const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
  const common = ['--local', '--persist-to', destination];
  await command(process.execPath, [
    wrangler,
    'd1',
    'execute',
    'domain-desk',
    ...common,
    '--file',
    verified.databaseFile,
    '--yes'
  ]);
  for (const item of verified.manifest.attachments)
    await command(process.execPath, [
      wrangler,
      'r2',
      'object',
      'put',
      `domain-desk-attachments/${item.object_key}`,
      ...common,
      '--file',
      resolve(verified.root, item.backup_path)
    ]);
  return verified.manifest.attachments.length;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--local') || args.includes('--remote'))
    throw new Error('Restore is local-only; specify --local.');
  const value = (flag) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : null;
  };
  const backup = value('--backup');
  const target = value('--persist-to');
  if (!backup || !target || backup.startsWith('-') || target.startsWith('-'))
    throw new Error('Usage: restore.mjs --local --backup <directory> --persist-to <new-disposable-directory>');
  const count = await restoreLocal(backup, target);
  console.log(`Verified backup restored to fresh local target ${resolve(target)} (${count} attachments).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
