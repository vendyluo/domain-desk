import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ingestRaw } from '../src/ingest';
import { authorizeRequest } from '../src/auth';
import { attachmentResponse } from '../src/lib/server/attachments';
import type { Env } from '../src/types';

const bytes = (s: string) => new TextEncoder().encode(s).buffer;
const mail = (headers = '', body = 'Hello world') =>
  bytes(
    `From: Alice Person <ALICE@Sender.test>\r\nTo: Hello <hello@example.com>\r\nDate: Tue, 21 Jul 2026 10:00:00 +0000\r\nSubject: Question\r\n${headers}\r\n${body}`
  );
const count = async (table: string) =>
  (await env.DB.prepare(`SELECT count(*) n FROM ${table}`).first<{ n: number }>())!.n;

describe('inbound ingestion', () => {
  it('fails closed on the web boundary and permits only explicit local development bypass', async () => {
    const production = {
      ...(env as unknown as Env),
      LOCAL_DEV: 'false',
      ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
      ACCESS_AUD: 'expected-audience'
    };
    expect(await authorizeRequest(new Request('https://crm.test'), production)).toBe(false);
    expect(
      await authorizeRequest(
        new Request('https://crm.test', { headers: { 'Cf-Access-Jwt-Assertion': 'forged' } }),
        production
      )
    ).toBe(false);
    const local = { ...production, LOCAL_DEV: 'true' };
    expect(await authorizeRequest(new Request('https://crm.test'), local)).toBe(true);
  });

  it('creates the complete graph and deduplicates Message-ID delivery', async () => {
    const raw = mail('Message-ID: <First@Sender.test>\r\n');
    const first = await ingestRaw(env as Env, 'HELLO@example.com', raw, new Date('2026-07-21T10:00:05Z'));
    expect(first.duplicate).toBe(false);
    expect(await count('contacts')).toBe(1);
    expect(await count('contact_email_addresses')).toBe(1);
    expect(await count('conversations')).toBe(1);
    expect(await count('messages')).toBe(1);
    expect(await count('message_recipients')).toBe(1);
    const row = await env.DB.prepare('SELECT * FROM messages').first<Record<string, string>>();
    expect(row).toMatchObject({
      sender_address: 'alice@sender.test',
      sender_name: 'Alice Person',
      message_id: 'first@sender.test',
      received_at: '2026-07-21T10:00:05.000Z'
    });
    expect(row!.sent_at).not.toBe(row!.received_at);
    expect(row!.ingested_at).not.toBe(row!.sent_at);
    const attribution = await env.DB.prepare(
      'SELECT d.name domain,p.name product,mi.address mailbox,mr.mailbox_identity_id FROM messages m JOIN mailbox_identities mi ON mi.id=m.mailbox_identity_id JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id JOIN message_recipients mr ON mr.message_id=m.id'
    ).first();
    expect(attribution).toMatchObject({
      domain: 'example.com',
      product: 'Example Product',
      mailbox: 'hello@example.com',
      mailbox_identity_id: 'mailbox-1'
    });
    expect((await ingestRaw(env as Env, 'hello@example.com', raw)).duplicate).toBe(true);
    expect(await count('messages')).toBe(1);
  });
  it('uses stable content dedupe without Message-ID or receive time', async () => {
    const firstRaw = mail('Received: from relay-one.example\r\n');
    const redeliveredRaw = mail('Received: from relay-two.example\r\n');
    const a = await ingestRaw(env as Env, 'hello@example.com', firstRaw, new Date('2026-01-01'));
    const b = await ingestRaw(env as Env, 'hello@example.com', redeliveredRaw, new Date('2026-02-01'));
    expect(b).toEqual({ id: a.id, duplicate: true });
    expect(await count('messages')).toBe(1);
  });
  it('threads only by References/In-Reply-To, never matching subject', async () => {
    const parent = await ingestRaw(env as Env, 'hello@example.com', mail('Message-ID: <parent@x>\r\n'));
    await ingestRaw(env as Env, 'hello@example.com', mail('Message-ID: <unrelated@x>\r\n'));
    const reply = await ingestRaw(
      env as Env,
      'hello@example.com',
      mail(
        'Message-ID: <reply@x>\r\nReferences: <missing@x><parent@x>\r\nIn-Reply-To: <also-missing@x> (comment) <parent@x>\r\n'
      )
    );
    const rows = await env.DB.prepare('SELECT id,conversation_id FROM messages').all<{
      id: string;
      conversation_id: string;
    }>();
    expect(rows.results.find((x) => x.id === reply.id)!.conversation_id).toBe(
      rows.results.find((x) => x.id === parent.id)!.conversation_id
    );
    expect(await count('conversations')).toBe(2);
  });
  it('stores attachment binary first at a deterministic key and keeps duplicates consistent', async () => {
    const raw = bytes(
      'From: A <a@x.test>\r\nTo: hello@example.com\r\nMessage-ID: <attach@x>\r\nContent-Type: multipart/mixed; boundary=z\r\n\r\n--z\r\nContent-Type: text/plain\r\n\r\nHi\r\n--z\r\nContent-Type: application/octet-stream; name=x.bin\r\nContent-Disposition: attachment; filename=x.bin\r\nContent-ID: <binary-1>\r\nContent-Transfer-Encoding: base64\r\n\r\nAQIDBA==\r\n--z--'
    );
    await ingestRaw(env as Env, 'hello@example.com', raw);
    const meta = await env.DB.prepare('SELECT * FROM attachments').first<Record<string, string | number>>();
    expect(meta).toMatchObject({ size: 4, disposition: 'attachment', content_id: '<binary-1>' });
    expect(new Uint8Array(await (await env.ATTACHMENTS.get(String(meta!.object_key)))!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4])
    );
    await ingestRaw(env as Env, 'hello@example.com', raw);
    expect(await count('attachments')).toBe(1);
    expect((await env.ATTACHMENTS.list()).objects).toHaveLength(1);
  });
  it('downloads only related R2 binary with safe headers and reports storage drift', async () => {
    const raw = bytes(
      'From: A <a@x.test>\r\nTo: hello@example.com\r\nMessage-ID: <download@x>\r\nContent-Type: multipart/mixed; boundary=z\r\n\r\n--z\r\nContent-Type: text/plain\r\n\r\nHi\r\n--z\r\nContent-Type: application/octet-stream; name="報價/\".bin"\r\nContent-Disposition: attachment; filename="報價/\".bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nAQIDBA==\r\n--z--'
    );
    await ingestRaw(env as Env, 'hello@example.com', raw);
    const metadata = await env.DB.prepare('SELECT id,object_key FROM attachments').first<{
      id: string;
      object_key: string;
    }>();
    const response = await attachmentResponse(env.DB, env.ATTACHMENTS, metadata!.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect((await attachmentResponse(env.DB, env.ATTACHMENTS, 'missing')).status).toBe(404);
    await env.ATTACHMENTS.delete(metadata!.object_key);
    expect((await attachmentResponse(env.DB, env.ATTACHMENTS, metadata!.id)).status).toBe(410);
  });
  it('leaves no CRM metadata when R2 attachment storage fails', async () => {
    const failing = {
      ...(env as unknown as Env),
      ATTACHMENTS: new Proxy(env.ATTACHMENTS, {
        get(target, prop) {
          if (prop === 'put') return () => Promise.reject(new Error('R2 unavailable'));
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      })
    } as Env;
    const raw = bytes(
      'From: A <a@x.test>\r\nTo: hello@example.com\r\nContent-Type: multipart/mixed; boundary=z\r\n\r\n--z\r\nContent-Disposition: attachment; filename=x\r\n\r\nx\r\n--z--'
    );
    await expect(ingestRaw(failing, 'hello@example.com', raw)).rejects.toMatchObject({
      code: 'attachment_storage_failed'
    });
    expect(await count('messages')).toBe(0);
    expect(await count('contacts')).toBe(0);
    expect(await count('attachments')).toBe(0);
  });
  it('rejects unknown mailbox and malformed messages observably without state', async () => {
    await expect(ingestRaw(env as Env, 'other@example.com', mail())).rejects.toMatchObject({ code: 'unknown_mailbox' });
    await expect(ingestRaw(env as Env, 'hello@example.com', bytes('not an email'))).rejects.toMatchObject({
      code: 'malformed_mime'
    });
    expect(await count('messages')).toBe(0);
    expect(await count('contacts')).toBe(0);
  });
});
