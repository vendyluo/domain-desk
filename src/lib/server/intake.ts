import type { Env } from '../../types';
import { IngestError } from '../../types';
import { hash, persistInbound, resolveContactId } from '../../ingest';

const LIMITS = { email: 320, name: 200, subject: 200, message: 10_000 } as const;

export type IntakeFields = {
  email?: unknown;
  name?: unknown;
  subject?: unknown;
  message?: unknown;
  website?: unknown; // honeypot: humans never see it, bots fill it
  turnstileToken?: unknown;
};

export type TurnstileVerifier = (secret: string, token: string, remoteIp?: string) => Promise<boolean>;

export const verifyTurnstile: TurnstileVerifier = async (secret, token, remoteIp) => {
  // Fail closed on every failure mode: a rejected fetch, an error status, or an
  // unparseable body all mean the submission was not proven human.
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) })
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
};

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max + 1) : '';
}

export function originAllowed(origin: string | null, domain: string): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

export async function submitIntake(
  env: Pick<Env, 'DB' | 'TURNSTILE_SECRET_KEY'>,
  mailboxId: string,
  fields: IntakeFields,
  origin: string | null,
  options: { remoteIp?: string; verify?: TurnstileVerifier; now?: Date } = {}
): Promise<{ id: string; conversationId: string; duplicate: boolean } | { dropped: true }> {
  const now = options.now ?? new Date();
  const mailbox = await env.DB.prepare(
    `SELECT mi.id,mi.address,d.name domain FROM mailbox_identities mi
     JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id WHERE mi.id=?`
  )
    .bind(mailboxId)
    .first<{ id: string; address: string; domain: string }>();
  if (!mailbox) throw new IngestError('unknown_mailbox', 'This intake endpoint does not exist.');
  if (!originAllowed(origin, mailbox.domain)) {
    throw new IngestError('invalid_origin', 'Submissions are only accepted from pages on the configured domain.');
  }
  if (!env.TURNSTILE_SECRET_KEY) {
    throw new IngestError('not_configured', 'Form intake is not configured: missing Turnstile secret.');
  }

  // Honeypot: report success to the caller but write nothing.
  if (typeof fields.website === 'string' && fields.website.trim()) return { dropped: true };

  const email = text(fields.email, LIMITS.email).toLowerCase();
  const name = text(fields.name, LIMITS.name);
  const subject = text(fields.subject, LIMITS.subject);
  const message = text(fields.message, LIMITS.message);
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > LIMITS.email ||
    !message ||
    message.length > LIMITS.message ||
    name.length > LIMITS.name ||
    subject.length > LIMITS.subject
  ) {
    throw new IngestError('invalid_submission', 'A valid email and a message within the size limits are required.');
  }

  const token = typeof fields.turnstileToken === 'string' ? fields.turnstileToken : '';
  const verifier = options.verify ?? verifyTurnstile;
  if (!token || !(await verifier(env.TURNSTILE_SECRET_KEY, token, options.remoteIp))) {
    throw new IngestError('turnstile_failed', 'Human verification failed.');
  }

  const at = now.toISOString();
  // Identical resubmissions on the same day collapse into one message.
  const dedupeKey = `form:${await hash(`${email}\n${subject}\n${message}\n${at.slice(0, 10)}`)}`;
  const existing = await env.DB.prepare(
    'SELECT id,conversation_id FROM messages WHERE mailbox_identity_id=? AND dedupe_key=?'
  )
    .bind(mailbox.id, dedupeKey)
    .first<{ id: string; conversation_id: string }>();
  if (existing) return { id: existing.id, conversationId: existing.conversation_id, duplicate: true };

  const messageKey = await hash(`${mailbox.id}\n${dedupeKey}`);
  const persisted = await persistInbound(env.DB, {
    mailboxId: mailbox.id,
    contactId: await resolveContactId(env.DB, email),
    senderAddress: email,
    senderName: name || null,
    conversationId: `conv:${messageKey}`,
    messageId: `msg:${messageKey}`,
    messageKey,
    dedupeKey,
    subject: subject || null,
    textBody: message,
    sentAt: at,
    receivedAt: at,
    ingestedAt: new Date().toISOString(),
    channel: 'form',
    recipients: [{ kind: 'to', address: mailbox.address, name: null, mailboxIdentityId: mailbox.id }]
  });
  if (persisted.duplicate) return persisted;
  console.log(
    JSON.stringify({ event: 'form_ingested', mailbox_id: mailbox.id, message_id: persisted.id, channel: 'form' })
  );
  return persisted;
}
