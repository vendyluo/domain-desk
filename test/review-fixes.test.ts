import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ingestRaw, resolveContactId } from '../src/ingest';
import { listInbox } from '../src/lib/server/inbox';
import { createNextAction, listToday, transitionNextAction } from '../src/lib/server/actions';
import { mergeContacts } from '../src/lib/server/contacts';
import { createOpportunity, transitionOpportunity } from '../src/lib/server/opportunities';
import { sendReply } from './reply-fixture';
import { intakeMailboxes } from '../src/lib/server/health';
import { verifyTurnstile } from '../src/lib/server/intake';
import { handleIntakeRequest } from '../src/intake-http';
import type { Env } from '../src/types';

const raw = (headers: string, body = 'Body') => new TextEncoder().encode(`${headers}\r\n\r\n${body}`).buffer;
const fakeSend = (messageId = '<out@example.com>') => {
  const calls: Array<Parameters<SendEmail['send']>[0]> = [];
  return {
    calls,
    binding: {
      send: async (message: Parameters<SendEmail['send']>[0]) => {
        calls.push(message);
        return { messageId };
      }
    } as SendEmail
  };
};
const count = async (table: string) =>
  (await env.DB.prepare(`SELECT count(*) n FROM ${table}`).first<{ n: number }>())!.n;

describe('reply thread fidelity', () => {
  it('quotes the sender Message-ID with its original casing in In-Reply-To and References', async () => {
    await ingestRaw(
      env as Env,
      'hello@example.com',
      raw(
        'From: Ada <ada@customer.test>\r\nTo: hello@example.com\r\nMessage-ID: <CAE9zXyZ_Mixed@mail.Gmail.com>\r\nReferences: <RootID_Abc@mail.Gmail.com>\r\nSubject: Pricing'
      ),
      new Date('2026-09-01T10:00:00Z')
    );
    const stored = (await env.DB.prepare('SELECT * FROM messages').first<any>())!;
    expect(stored.message_id).toBe('cae9zxyz_mixed@mail.gmail.com'); // normalized for matching
    expect(stored.message_id_raw).toBe('CAE9zXyZ_Mixed@mail.Gmail.com'); // verbatim for headers
    expect(JSON.parse(stored.references_raw_json)).toEqual(['RootID_Abc@mail.Gmail.com']);

    const conversation = (await env.DB.prepare('SELECT id FROM conversations').first<{ id: string }>())!;
    const fake = fakeSend();
    await sendReply({ DB: env.DB, EMAIL: fake.binding }, conversation.id, 'Sure thing.');
    expect(fake.calls[0].headers).toEqual({
      'In-Reply-To': '<CAE9zXyZ_Mixed@mail.Gmail.com>',
      References: '<RootID_Abc@mail.Gmail.com> <CAE9zXyZ_Mixed@mail.Gmail.com>'
    });
    const outbound = (await env.DB.prepare("SELECT * FROM messages WHERE direction='outbound'").first<any>())!;
    expect(JSON.parse(outbound.references_json)).toEqual([
      'rootid_abc@mail.gmail.com',
      'cae9zxyz_mixed@mail.gmail.com'
    ]);
  });

  it('falls back to the normalized id for rows written before the migration', async () => {
    await ingestRaw(
      env as Env,
      'hello@example.com',
      raw('From: B <b@x.test>\r\nTo: hello@example.com\r\nMessage-ID: <legacy@x.test>\r\nSubject: Old'),
      new Date('2026-09-01T10:00:00Z')
    );
    await env.DB.prepare('UPDATE messages SET message_id_raw=NULL,references_raw_json=NULL').run();
    const conversation = (await env.DB.prepare('SELECT id FROM conversations').first<{ id: string }>())!;
    const fake = fakeSend();
    await sendReply({ DB: env.DB, EMAIL: fake.binding }, conversation.id, 'Reply');
    expect(fake.calls[0].headers).toMatchObject({ 'In-Reply-To': '<legacy@x.test>' });
  });

  it('indexes messages by conversation for the search probe and reply lookup', async () => {
    const index = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='messages' AND name='messages_conversation'"
    ).first<{ name: string }>();
    expect(index?.name).toBe('messages_conversation');
  });
});

describe('contact merge cycle safety', () => {
  it('aborts the whole merge when the survivor was merged away concurrently', async () => {
    for (const [from, id] of [
      ['A <a@x.test>', 'a'],
      ['B <b@x.test>', 'b'],
      ['C <c@x.test>', 'c']
    ] as const) {
      await ingestRaw(
        env as Env,
        'hello@example.com',
        raw(`From: ${from}\r\nTo: hello@example.com\r\nMessage-ID: <${id}@x>\r\nSubject: ${id}`)
      );
    }
    const contactOf = async (subject: string) =>
      (await env.DB.prepare('SELECT contact_id FROM messages WHERE subject=?').bind(subject).first<any>())!.contact_id;
    const [a, b, c] = [await contactOf('a'), await contactOf('b'), await contactOf('c')];
    const original = env.DB.batch.bind(env.DB);
    try {
      (env.DB as any).batch = async (statements: any[]) => {
        // A concurrent merge retires the survivor between the read and the write.
        await env.DB.prepare('UPDATE contacts SET merged_into_id=? WHERE id=?').bind(c, a).run();
        return original(statements);
      };
      await expect(mergeContacts(env.DB, a, b, b)).rejects.toThrow();
    } finally {
      (env.DB as any).batch = original;
    }
    // Nothing from the aborted merge committed.
    expect(
      (await env.DB.prepare('SELECT merged_into_id FROM contacts WHERE id=?').bind(b).first<any>())!.merged_into_id
    ).toBe(null);
    expect(
      (await env.DB.prepare('SELECT contact_id FROM messages WHERE subject=?').bind('b').first<any>())!.contact_id
    ).toBe(b);
    expect(await count('contact_merges')).toBe(0);
  });

  it('degrades instead of hanging when the merge chain already contains a cycle', async () => {
    for (const [from, id] of [
      ['A <a@x.test>', 'a'],
      ['B <b@x.test>', 'b']
    ] as const) {
      await ingestRaw(
        env as Env,
        'hello@example.com',
        raw(`From: ${from}\r\nTo: hello@example.com\r\nMessage-ID: <${id}@x>\r\nSubject: ${id}`)
      );
    }
    const a = (await env.DB.prepare("SELECT contact_id FROM messages WHERE subject='a'").first<any>())!.contact_id;
    const b = (await env.DB.prepare("SELECT contact_id FROM messages WHERE subject='b'").first<any>())!.contact_id;
    await env.DB.batch([
      env.DB.prepare('UPDATE contacts SET merged_into_id=? WHERE id=?').bind(b, a),
      env.DB.prepare('UPDATE contacts SET merged_into_id=? WHERE id=?').bind(a, b)
    ]);
    // The bounded walk returns rather than spinning, and ingestion still files mail.
    await expect(resolveContactId(env.DB, 'a@x.test')).resolves.toBeTypeOf('string');
    await ingestRaw(
      env as Env,
      'hello@example.com',
      raw('From: A <a@x.test>\r\nTo: hello@example.com\r\nMessage-ID: <after-cycle@x>\r\nSubject: after')
    );
    expect((await env.DB.prepare("SELECT count(*) n FROM messages WHERE subject='after'").first<any>())!.n).toBe(1);
  });
});

describe('inbox reflects inbound correspondence only', () => {
  it('keeps the customer as sender and excludes reply text from search after replying', async () => {
    await ingestRaw(
      env as Env,
      'hello@example.com',
      raw(
        'From: Ada <ada@customer.test>\r\nTo: hello@example.com\r\nMessage-ID: <q@x>\r\nSubject: Quote',
        'CUSTOMERWORD please quote'
      ),
      new Date('2026-09-01T09:00:00Z')
    );
    const conversation = (await env.DB.prepare('SELECT id FROM conversations').first<{ id: string }>())!;
    await sendReply(
      { DB: env.DB, EMAIL: fakeSend().binding },
      conversation.id,
      'OPERATORWORD thanks for reaching out',
      new Date('2026-09-01T10:00:00Z')
    );
    const rows = (await listInbox(env.DB, {})).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].sender_address).toBe('ada@customer.test');
    expect(rows[0].preview).toContain('CUSTOMERWORD');
    expect((await listInbox(env.DB, { q: 'CUSTOMERWORD' })).rows).toHaveLength(1);
    expect((await listInbox(env.DB, { q: 'OPERATORWORD' })).rows).toHaveLength(0);
    expect((await listInbox(env.DB, { q: 'hello@example.com' })).rows).toHaveLength(0);
  });
});

describe('Today keeps every action the query returned', () => {
  it('shows a designated opportunity action rescheduled into the future', async () => {
    await ingestRaw(
      env as Env,
      'hello@example.com',
      raw('From: Buyer <buyer@x.test>\r\nTo: hello@example.com\r\nMessage-ID: <deal@x>\r\nSubject: Deal')
    );
    const conversation = (await env.DB.prepare('SELECT id FROM conversations').first<{ id: string }>())!;
    const opportunity = await createOpportunity(env.DB, {
      title: 'Deal',
      desiredOutcome: 'Close',
      conversationId: conversation.id
    });
    await transitionOpportunity(env.DB, opportunity, 'qualify');
    await transitionOpportunity(env.DB, opportunity, 'activate', { nextAction: 'Call them' });
    const action = (await env.DB.prepare('SELECT id FROM next_actions WHERE opportunity_id=? AND is_designated=1')
      .bind(opportunity)
      .first<{ id: string }>())!;
    await transitionNextAction(env.DB, action.id, 'reschedule', { due: '2026-09-10T09:00' });
    const today = await listToday(env.DB, new Date('2026-09-01T12:00:00Z'));
    expect([...today.overdue, ...today.due].map((row: any) => row.id)).toContain(action.id);
    expect(today.overdue).toHaveLength(0);
  });

  it('still separates overdue from due-today for ordinary actions', async () => {
    await ingestRaw(
      env as Env,
      'hello@example.com',
      raw('From: X <x@x.test>\r\nTo: hello@example.com\r\nMessage-ID: <p@x>\r\nSubject: P')
    );
    const contact = (await env.DB.prepare('SELECT id FROM contacts').first<{ id: string }>())!;
    const past = await createNextAction(env.DB, {
      description: 'Late',
      due: '2026-08-20T09:00',
      sourceType: 'contact',
      sourceId: contact.id
    });
    const now = await createNextAction(env.DB, {
      description: 'Today',
      due: '2026-09-01T09:00',
      sourceType: 'contact',
      sourceId: contact.id
    });
    const today = await listToday(env.DB, new Date('2026-09-01T12:00:00Z'));
    expect(today.overdue.map((row: any) => row.id)).toEqual([past]);
    expect(today.due.map((row: any) => row.id)).toEqual([now]);
  });
});

describe('public surface failure modes', () => {
  it('fails Turnstile closed when the verifier cannot be reached', async () => {
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        throw new TypeError('network unreachable');
      }) as typeof fetch;
      await expect(verifyTurnstile('secret', 'token')).resolves.toBe(false);
      globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
      await expect(verifyTurnstile('secret', 'token')).resolves.toBe(false);
      globalThis.fetch = (async () => new Response('not json', { status: 200 })) as typeof fetch;
      await expect(verifyTurnstile('secret', 'token')).resolves.toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('answers malformed percent-encoding with the bare 404 code, not an exception', async () => {
    const response = await handleIntakeRequest(
      new Request('https://desk.example/intake/%E0%A4%A', {
        method: 'POST',
        body: new URLSearchParams({ email: 'a@b.test', message: 'hi', 'cf-turnstile-response': 't' }),
        headers: { Origin: 'https://example.com' }
      }),
      { ...(env as unknown as Env), TURNSTILE_SECRET_KEY: 'secret' },
      async () => true
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('unknown_mailbox');
  });
});

describe('settings health surface', () => {
  it('returns an empty mailbox list instead of throwing on an unmigrated database', async () => {
    expect(await intakeMailboxes(env.DB)).toEqual([
      { id: 'mailbox-1', address: 'hello@example.com', domain: 'example.com' }
    ]);
    await env.DB.prepare('DROP TABLE mailbox_identities').run();
    await expect(intakeMailboxes(env.DB)).resolves.toEqual([]);
  });
});
