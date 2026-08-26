import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ingestRaw } from '../src/ingest';
import { listInbox, setHandled } from '../src/lib/server/inbox';
import type { Env } from '../src/types';

describe('inbox services', () => {
  it('filters safely and reversibly updates handling state', async () => {
    const raw = new TextEncoder().encode(
      'From: 顾客 <customer@example.test>\r\nTo: hello@example.com\r\nMessage-ID: <ui@example.test>\r\nSubject: Pricing 100%\r\n\r\nPlain preview'
    ).buffer;
    await ingestRaw(env as Env, 'hello@example.com', raw, new Date('2026-07-22T12:00:00Z'));
    const all = await listInbox(env.DB, {});
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]).toMatchObject({
      product: 'Example Product',
      domain: 'example.com',
      mailbox: 'hello@example.com',
      needs_attention: 1
    });
    expect((await listInbox(env.DB, { q: '100%' })).rows).toHaveLength(1);
    expect((await listInbox(env.DB, { q: 'does-not-exist' })).rows).toHaveLength(0);
    expect(await setHandled(env.DB, all.rows[0].id, false)).toBe(true);
    expect((await listInbox(env.DB, { state: 'handled' })).rows[0].needs_attention).toBe(0);
    expect(await setHandled(env.DB, 'missing', true)).toBe(false);
  });
});
