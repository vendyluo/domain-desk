import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ingestRaw } from '../src/ingest';
import { sendReply } from './reply-fixture';
import { saveReplyDraft } from '../src/lib/server/outbound';
import type { Env } from '../src/types';

const inboundRaw = (headers = 'Message-ID: <parent@customer.test>\r\n') =>
  new TextEncoder().encode(
    `From: Ada Customer <ada@customer.test>\r\nTo: hello@example.com\r\n${headers}Subject: Pricing question\r\n\r\nHow much for 25 seats?`
  ).buffer;

type SentCall = Parameters<SendEmail['send']>[0];

function fakeEmail(result: { messageId: string } | Error) {
  const calls: SentCall[] = [];
  return {
    calls,
    binding: {
      send: async (message: SentCall) => {
        calls.push(message);
        if (result instanceof Error) throw result;
        return result;
      }
    } as SendEmail
  };
}

async function conversationId() {
  await ingestRaw(env as Env, 'hello@example.com', inboundRaw(), new Date('2026-08-01T10:00:00Z'));
  return (await env.DB.prepare('SELECT id FROM conversations').first<{ id: string }>())!.id;
}

describe('outbound replies', () => {
  it('sends a threaded reply from the mailbox and records the confirmed message', async () => {
    const conv = await conversationId();
    const fake = fakeEmail({ messageId: '<Generated-42@Example.com>' });
    const { id } = await sendReply(
      { DB: env.DB, EMAIL: fake.binding },
      conv,
      '  Happy to help — 25 seats is $250/mo.  ',
      new Date('2026-08-01T11:00:00Z')
    );
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      from: { email: 'hello@example.com', name: 'Hello' },
      to: { email: 'ada@customer.test', name: 'Ada Customer' },
      subject: 'Re: Pricing question',
      text: 'Happy to help — 25 seats is $250/mo.',
      headers: {
        'In-Reply-To': '<parent@customer.test>',
        References: '<parent@customer.test>'
      }
    });
    const row = (await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(id).first<any>())!;
    expect(row).toMatchObject({
      direction: 'outbound',
      delivery_status: 'sent',
      delivery_error: null,
      message_id: 'generated-42@example.com',
      in_reply_to: 'parent@customer.test',
      sender_address: 'hello@example.com',
      subject: 'Re: Pricing question',
      conversation_id: conv
    });
    const recipient = (await env.DB.prepare('SELECT * FROM message_recipients WHERE message_id=?')
      .bind(id)
      .first<any>())!;
    expect(recipient).toMatchObject({ kind: 'to', address: 'ada@customer.test', mailbox_identity_id: null });
    const events = (
      await env.DB.prepare(
        "SELECT event_type FROM activity_events WHERE subject_id=? AND event_type IN ('reply.send_requested','reply.accepted') ORDER BY occurred_at,id"
      )
        .bind(conv)
        .all<{ event_type: string }>()
    ).results.map((event) => event.event_type);
    expect(events).toEqual(['reply.send_requested', 'reply.accepted']);
    expect(
      (await env.DB.prepare('SELECT updated_at FROM conversations WHERE id=?').bind(conv).first<any>())!.updated_at
    ).toBe('2026-08-01T11:00:00.000Z');
  });

  it('keeps the failed send visible with its error code and audit trail', async () => {
    const conv = await conversationId();
    const failure = Object.assign(new Error('domain not onboarded'), { code: 'E_SENDER_NOT_VERIFIED' });
    const fake = fakeEmail(failure);
    await expect(sendReply({ DB: env.DB, EMAIL: fake.binding }, conv, 'Hello there')).rejects.toThrow(
      'E_SENDER_NOT_VERIFIED'
    );
    const row = (await env.DB.prepare("SELECT * FROM messages WHERE direction='outbound'").first<any>())!;
    expect(row).toMatchObject({ delivery_status: 'failed', delivery_error: 'E_SENDER_NOT_VERIFIED' });
    const events = (
      await env.DB.prepare(
        "SELECT event_type,new_state_json FROM activity_events WHERE subject_id=? AND event_type IN ('reply.send_requested','reply.failed') ORDER BY occurred_at,id"
      )
        .bind(conv)
        .all<any>()
    ).results;
    expect(events.map((event: any) => event.event_type)).toEqual(['reply.send_requested', 'reply.failed']);
    expect(JSON.parse(events[1].new_state_json).code).toBe('E_SENDER_NOT_VERIFIED');
  });

  it('refuses to send without the binding or a valid body, writing no state', async () => {
    const conv = await conversationId();
    await expect(sendReply({ DB: env.DB, EMAIL: undefined }, conv, 'Hi')).rejects.toThrow('not configured');
    const fake = fakeEmail({ messageId: '<x@y>' });
    await expect(saveReplyDraft(env.DB, conv, '')).rejects.toThrow('required');
    await expect(saveReplyDraft(env.DB, 'missing', 'Hi')).rejects.toThrow('not found');
    expect((await env.DB.prepare("SELECT count(*) n FROM messages WHERE direction='outbound'").first<any>())!.n).toBe(
      0
    );
    expect(fake.calls).toHaveLength(0);
  });

  it('does not duplicate Re: prefixes and skips threading headers without a Message-ID', async () => {
    await ingestRaw(
      env as Env,
      'hello@example.com',
      new TextEncoder().encode('From: B <b@x.test>\r\nTo: hello@example.com\r\nSubject: RE: Renewal\r\n\r\nPing')
        .buffer,
      new Date('2026-08-01T10:00:00Z')
    );
    const conv = (await env.DB.prepare('SELECT id FROM conversations').first<{ id: string }>())!.id;
    const fake = fakeEmail({ messageId: '<m@n>' });
    await sendReply({ DB: env.DB, EMAIL: fake.binding }, conv, 'Renewed.');
    expect(fake.calls[0].subject).toBe('RE: Renewal');
    expect(fake.calls[0].headers).toBeUndefined();
  });

  it('threads the customer answer to a sent reply back into the same conversation', async () => {
    const conv = await conversationId();
    const fake = fakeEmail({ messageId: '<our-reply@example.com>' });
    await sendReply({ DB: env.DB, EMAIL: fake.binding }, conv, 'Answer', new Date('2026-08-01T12:00:00Z'));
    await ingestRaw(
      env as Env,
      'hello@example.com',
      new TextEncoder().encode(
        'From: Ada Customer <ada@customer.test>\r\nTo: hello@example.com\r\nMessage-ID: <followup@customer.test>\r\nIn-Reply-To: <our-reply@example.com>\r\nReferences: <parent@customer.test> <our-reply@example.com>\r\nSubject: Re: Pricing question\r\n\r\nSounds good!'
      ).buffer,
      new Date('2026-08-02T09:00:00Z')
    );
    const conversations = await env.DB.prepare('SELECT count(*) n FROM conversations').first<any>();
    expect(conversations!.n).toBe(1);
    const timeline = (
      await env.DB.prepare('SELECT direction,text_body FROM messages WHERE conversation_id=? ORDER BY received_at,id')
        .bind(conv)
        .all<any>()
    ).results;
    expect(timeline.map((m: any) => m.direction)).toEqual(['inbound', 'outbound', 'inbound']);
  });
});
