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
  'migrations/0003_opportunities.sql',
  'migrations/0004_outbound.sql',
  'migrations/0005_form_intake.sql',
  'migrations/0006_thread_fidelity.sql',
  'migrations/0007_reply_approval.sql'
]) {
  await run(['d1', 'execute', 'domain-desk', '--local', '--persist-to', state, '--file', migration]);
}
const sql = (await readFile('test/e2e/fixtures.sql', 'utf8'))
  .replaceAll('__ATTACHMENT_HASH__', hash)
  .replaceAll('__ATTACHMENT_SIZE__', String(binary.byteLength));
await writeFile(fixtureSql, sql);
await writeFile(fixtureFile, binary);
await run(['d1', 'execute', 'domain-desk', '--local', '--persist-to', state, '--file', fixtureSql]);
for (const viewport of ['desktop', 'mobile']) {
  // Synthetic failure states are separate from the actual simulator-send flow.
  await run([
    'd1',
    'execute',
    'domain-desk',
    '--local',
    '--persist-to',
    state,
    '--command',
    `
    INSERT INTO conversations(id,mailbox_identity_id,contact_id,subject,needs_attention,created_at,updated_at)
    SELECT 'uncertain:${viewport}',mailbox_identity_id,contact_id,'Unresolved reply ${viewport}',1,created_at,updated_at FROM conversations WHERE id='conversation:e2e';
    INSERT INTO messages(id,conversation_id,mailbox_identity_id,contact_id,dedupe_key,sender_address,subject,text_body,received_at,ingested_at,direction,delivery_status)
    SELECT 'uncertain-message:${viewport}','uncertain:${viewport}',mailbox_identity_id,contact_id,'uncertain:${viewport}','hello@inquiries.example','Re: Quote','Saved reply awaiting provider evidence',received_at,ingested_at,'outbound','sending' FROM messages WHERE id='message:e2e';
    INSERT INTO reply_drafts(id,conversation_id,state,body,context_json,content_hash,message_row_id,error_code,created_at,updated_at)
    VALUES('uncertain-reply:${viewport}','uncertain:${viewport}','indeterminate','Saved reply awaiting provider evidence','{}','fixture','uncertain-message:${viewport}','provider_response_unknown','2026-08-25T12:00:00Z','2026-08-25T12:00:00Z');
  `
  ]);
}
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
