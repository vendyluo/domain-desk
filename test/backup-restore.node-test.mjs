import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test'; // Kept separate from the Workers Vitest pool.
import assert from 'node:assert/strict';
import { restoreLocal, verifyBackup } from '../scripts/restore.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'domain-desk-restore-test-'));
  await mkdir(join(root, 'attachments'));
  const attachment = Buffer.from('attachment payload');
  const sql = Buffer.from(
    `PRAGMA foreign_keys=ON;
CREATE TABLE messages(id TEXT PRIMARY KEY);
CREATE TABLE attachments(id TEXT PRIMARY KEY,message_id TEXT REFERENCES messages(id),object_key TEXT UNIQUE,size INTEGER,content_hash TEXT);
INSERT INTO messages VALUES('message-1');
INSERT INTO attachments VALUES('attachment-1','message-1','objects/a.txt',${attachment.length},'${hash(attachment)}');\n`
  );
  await writeFile(join(root, 'database.sql'), sql);
  await writeFile(join(root, 'attachments', 'a.txt'), attachment);
  const manifest = {
    version: 2,
    source: 'local',
    database: { backup_path: 'database.sql', size: sql.length, content_hash: hash(sql) },
    attachments: [
      {
        id: 'attachment-1',
        object_key: 'objects/a.txt',
        size: attachment.length,
        content_hash: hash(attachment),
        backup_path: 'attachments/a.txt',
        verified: true
      }
    ]
  };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  return root;
}

test('accepts a coherent database and attachment snapshot', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await verifyBackup(root);
  assert.equal(result.manifest.attachments.length, 1);
});

test('real Wrangler custom-state backup restores forward references and multiline Unicode without data loss', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = promisify(execFile);
  const source = join(root, 'source');
  const target = join(root, 'restored');
  const backup = join(root, 'backup');
  const second = join(root, 'roundtrip');
  const wrangler = './node_modules/wrangler/bin/wrangler.js';
  const sql = join(root, 'source.sql');
  // The earlier table references a later table. A per-table CREATE/INSERT export
  // passes sqlite3 verification but fails D1 import even with deferred FK checks.
  await writeFile(
    sql,
    `CREATE TABLE messages(id TEXT PRIMARY KEY,parent TEXT REFERENCES parents(id),body TEXT);
CREATE TABLE parents(id TEXT PRIMARY KEY);
CREATE TABLE attachments(id TEXT PRIMARY KEY,object_key TEXT,size INTEGER,content_hash TEXT);
INSERT INTO parents VALUES('parent');
INSERT INTO messages VALUES('message','parent','你好\nIt''s a quote; -- not SQL\nsecond line');`
  );
  await run(process.execPath, [
    wrangler,
    'd1',
    'execute',
    'domain-desk',
    '--local',
    '--persist-to',
    source,
    '--file',
    sql
  ]);
  await run(process.execPath, ['scripts/backup.mjs', '--local', '--persist-to', source, '--output', backup]);
  await restoreLocal(backup, target);
  await run(process.execPath, ['scripts/backup.mjs', '--local', '--persist-to', target, '--output', second]);
  assert.equal(
    await readFile(join(backup, 'database.sql'), 'utf8'),
    await readFile(join(second, 'database.sql'), 'utf8')
  );
  const result = await run(process.execPath, [
    wrangler,
    'd1',
    'execute',
    'domain-desk',
    '--local',
    '--persist-to',
    target,
    '--command',
    'SELECT body,parent FROM messages',
    '--json'
  ]);
  assert.deepEqual(JSON.parse(result.stdout)[0].results, [
    { body: "你好\nIt's a quote; -- not SQL\nsecond line", parent: 'parent' }
  ]);
});

test('rejects corruption before restore', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'attachments', 'a.txt'), 'tampered');
  const target = join(root, 'must-not-exist');
  await assert.rejects(restoreLocal(root, target), /Hash\/size verification failed/);
  await assert.rejects(access(target), { code: 'ENOENT' });
});

test('rejects a manifest that disagrees with the database snapshot', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.attachments[0].id = 'different';
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(verifyBackup(root), /do not match database snapshot/);
});

test('refuses existing targets and path/symlink escapes', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(restoreLocal(root, root), /non-fresh/);
  const file = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.attachments[0].backup_path = '../outside';
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(verifyBackup(root), /Unsafe backup path/);
  await symlink(tmpdir(), join(root, 'escape'));
  manifest.attachments[0].backup_path = 'escape';
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(verifyBackup(root), /escapes through a link/);
});

test('rejects corrupted SQL and orphaned foreign keys even if the manifest hash is updated', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestFile = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const original = await readFile(join(root, 'database.sql'), 'utf8');
  const sql = Buffer.from(
    original
      .replace('PRAGMA foreign_keys=ON;', 'PRAGMA foreign_keys=OFF;')
      .replace("INSERT INTO messages VALUES('message-1');", '')
  );
  await writeFile(join(root, 'database.sql'), sql);
  manifest.database = { ...manifest.database, size: sql.length, content_hash: hash(sql) };
  await writeFile(manifestFile, JSON.stringify(manifest));
  await assert.rejects(verifyBackup(root), /foreign key check failed/);
  await writeFile(join(root, 'database.sql'), 'broken sql');
  await assert.rejects(verifyBackup(root), /Hash\/size verification failed/);
});
