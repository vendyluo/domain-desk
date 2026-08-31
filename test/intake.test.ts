import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ingestRaw } from '../src/ingest';
import { originAllowed, submitIntake } from '../src/lib/server/intake';
import { sendReply } from '../src/lib/server/outbound';
import type { Env } from '../src/types';

const intakeEnv = { DB: env.DB, TURNSTILE_SECRET_KEY: 'test-secret' };
const pass = async () => true;
const fields = (overrides: Record<string, unknown> = {}) => ({
  email: 'Ada@Customer.test',
  name: 'Ada',
  subject: 'Pricing',
  message: 'How much for 25 seats?',
  turnstileToken: 'token',
  ...overrides
});
const origin = 'https://example.com';
const count = async (table: string) =>
  (await env.DB.prepare(`SELECT count(*) n FROM ${table}`).first<{ n: number }>())!.n;

describe('form intake', () => {
  it('creates the contact, conversation, and form message, and collapses same-day resubmission', async () => {
    const first = await submitIntake(intakeEnv, 'mailbox-1', fields(), origin, {
      verify: pass,
      now: new Date('2026-08-10T09:00:00Z')
    });
    expect(first).toMatchObject({ duplicate: false });
    const message = (await env.DB.prepare('SELECT * FROM messages').first<any>())!;
    expect(message).toMatchObject({
      channel: 'form',
      direction: 'inbound',
      sender_address: 'ada@customer.test',
      sender_name: 'Ada',
      subject: 'Pricing',
      text_body: 'How much for 25 seats?'
    });
    const conversation = (await env.DB.prepare('SELECT * FROM conversations').first<any>())!;
    expect(conversation).toMatchObject({ needs_attention: 1, subject: 'Pricing', mailbox_identity_id: 'mailbox-1' });
    expect((await env.DB.prepare('SELECT address FROM contact_email_addresses').first<any>())!.address).toBe(
      'ada@customer.test'
    );
    const again = await submitIntake(intakeEnv, 'mailbox-1', fields(), origin, {
      verify: pass,
      now: new Date('2026-08-10T09:05:00Z')
    });
    expect(again).toMatchObject({ duplicate: true });
    expect(await count('messages')).toBe(1);
    const nextDay = await submitIntake(intakeEnv, 'mailbox-1', fields(), origin, {
      verify: pass,
      now: new Date('2026-08-11T09:00:00Z')
    });
    expect(nextDay).toMatchObject({ duplicate: false });
    expect(await count('messages')).toBe(2);
  });

  it('unifies the form submitter with an existing email contact', async () => {
    await ingestRaw(
      env as Env,
      'hello@example.com',
      new TextEncoder().encode(
        'From: Ada <ada@customer.test>\r\nTo: hello@example.com\r\nMessage-ID: <m@x>\r\nSubject: Hi\r\n\r\nHi'
      ).buffer
    );
    await submitIntake(intakeEnv, 'mailbox-1', fields(), origin, { verify: pass });
    expect(await count('contacts')).toBe(1);
    expect(await count('conversations')).toBe(2);
  });

  it('rejects wrong origins, unknown mailboxes, missing configuration, and invalid fields without state', async () => {
    await expect(
      submitIntake(intakeEnv, 'mailbox-1', fields(), 'https://evil.test', { verify: pass })
    ).rejects.toMatchObject({ code: 'invalid_origin' });
    await expect(submitIntake(intakeEnv, 'mailbox-1', fields(), null, { verify: pass })).rejects.toMatchObject({
      code: 'invalid_origin'
    });
    await expect(submitIntake(intakeEnv, 'missing', fields(), origin, { verify: pass })).rejects.toMatchObject({
      code: 'unknown_mailbox'
    });
    await expect(
      submitIntake({ DB: env.DB, TURNSTILE_SECRET_KEY: undefined }, 'mailbox-1', fields(), origin, { verify: pass })
    ).rejects.toMatchObject({ code: 'not_configured' });
    await expect(
      submitIntake(intakeEnv, 'mailbox-1', fields({ email: 'not-an-email' }), origin, { verify: pass })
    ).rejects.toMatchObject({ code: 'invalid_submission' });
    await expect(
      submitIntake(intakeEnv, 'mailbox-1', fields({ message: '' }), origin, { verify: pass })
    ).rejects.toMatchObject({ code: 'invalid_submission' });
    await expect(
      submitIntake(intakeEnv, 'mailbox-1', fields({ message: 'x'.repeat(10_001) }), origin, { verify: pass })
    ).rejects.toMatchObject({ code: 'invalid_submission' });
    expect(await count('messages')).toBe(0);
    expect(await count('contacts')).toBe(0);
  });

  it('fails closed on Turnstile and silently drops honeypot submissions', async () => {
    let verifierCalls = 0;
    const failing = async () => {
      verifierCalls += 1;
      return false;
    };
    await expect(submitIntake(intakeEnv, 'mailbox-1', fields(), origin, { verify: failing })).rejects.toMatchObject({
      code: 'turnstile_failed'
    });
    await expect(
      submitIntake(intakeEnv, 'mailbox-1', fields({ turnstileToken: null }), origin, { verify: failing })
    ).rejects.toMatchObject({ code: 'turnstile_failed' });
    const dropped = await submitIntake(intakeEnv, 'mailbox-1', fields({ website: 'http://spam' }), origin, {
      verify: failing
    });
    expect(dropped).toEqual({ dropped: true });
    expect(verifierCalls).toBe(1); // the honeypot drop never reaches the verifier
    expect(await count('messages')).toBe(0);
  });

  it('subdomain pages of the configured domain may submit', () => {
    expect(originAllowed('https://www.example.com', 'example.com')).toBe(true);
    expect(originAllowed('https://landing.example.com', 'example.com')).toBe(true);
    expect(originAllowed('https://notexample.com', 'example.com')).toBe(false);
    expect(originAllowed('https://example.com.evil.test', 'example.com')).toBe(false);
  });

  it('closes the loop: form in, email reply out, customer answer threads back', async () => {
    const submitted = await submitIntake(intakeEnv, 'mailbox-1', fields(), origin, {
      verify: pass,
      now: new Date('2026-08-10T09:00:00Z')
    });
    const conversationId = (submitted as { conversationId: string }).conversationId;
    const sent: Array<Parameters<SendEmail['send']>[0]> = [];
    const binding = {
      send: async (message: Parameters<SendEmail['send']>[0]) => {
        sent.push(message);
        return { messageId: '<form-reply@example.com>' };
      }
    } as SendEmail;
    await sendReply({ DB: env.DB, EMAIL: binding }, conversationId, 'Happy to help!', new Date('2026-08-10T10:00:00Z'));
    expect(sent[0]).toMatchObject({ to: { email: 'ada@customer.test', name: 'Ada' }, subject: 'Re: Pricing' });
    expect(sent[0].headers).toBeUndefined(); // a form message has no Message-ID to thread from
    await ingestRaw(
      env as Env,
      'hello@example.com',
      new TextEncoder().encode(
        'From: Ada <ada@customer.test>\r\nTo: hello@example.com\r\nMessage-ID: <answer@customer.test>\r\nIn-Reply-To: <form-reply@example.com>\r\nSubject: Re: Pricing\r\n\r\nGreat, go ahead!'
      ).buffer,
      new Date('2026-08-10T11:00:00Z')
    );
    expect(await count('conversations')).toBe(1);
    const timeline = (
      await env.DB.prepare('SELECT channel,direction FROM messages WHERE conversation_id=? ORDER BY received_at,id')
        .bind(conversationId)
        .all<any>()
    ).results;
    expect(timeline).toEqual([
      { channel: 'form', direction: 'inbound' },
      { channel: 'email', direction: 'outbound' },
      { channel: 'email', direction: 'inbound' }
    ]);
  });
});

describe('intake HTTP endpoint', () => {
  const post = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
    new Request(`https://desk.example${path}`, { method: 'POST', body: new URLSearchParams(body), headers });
  const httpEnv = { ...(env as unknown as Env), TURNSTILE_SECRET_KEY: 'test-secret' };
  const valid = {
    email: 'ada@customer.test',
    name: 'Ada',
    subject: 'Pricing',
    message: 'Hello',
    'cf-turnstile-response': 'token'
  };

  it('accepts a verified cross-origin submission and answers CORS', async () => {
    const { handleIntakeRequest } = await import('../src/intake-http');
    const response = await handleIntakeRequest(
      post('/intake/mailbox-1', valid, { Origin: 'https://www.example.com' }),
      httpEnv,
      pass
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://www.example.com');
    expect(await count('messages')).toBe(1);
  });

  it('maps rejections to bare status codes without echoing input', async () => {
    const { handleIntakeRequest } = await import('../src/intake-http');
    const wrongOrigin = await handleIntakeRequest(
      post('/intake/mailbox-1', valid, { Origin: 'https://evil.test' }),
      httpEnv,
      pass
    );
    expect(wrongOrigin.status).toBe(403);
    expect(await wrongOrigin.text()).toBe('invalid_origin');
    const missing = await handleIntakeRequest(
      post('/intake/nope', valid, { Origin: 'https://example.com' }),
      httpEnv,
      pass
    );
    expect(missing.status).toBe(404);
    expect(await count('messages')).toBe(0);
  });

  it("redirects only to the submitting page's own https origin", async () => {
    const { handleIntakeRequest } = await import('../src/intake-http');
    const good = await handleIntakeRequest(
      post(
        '/intake/mailbox-1',
        { ...valid, redirect: 'https://example.com/thanks' },
        { Origin: 'https://example.com' }
      ),
      httpEnv,
      pass
    );
    expect(good.status).toBe(303);
    expect(good.headers.get('Location')).toBe('https://example.com/thanks');
    const evil = await handleIntakeRequest(
      post(
        '/intake/mailbox-1',
        { ...valid, message: 'other day', redirect: 'https://evil.test/phish' },
        { Origin: 'https://example.com' }
      ),
      httpEnv,
      pass
    );
    expect(evil.status).toBe(200); // accepted, but the open redirect is refused
    expect(evil.headers.get('Location')).toBe(null);
  });
});
