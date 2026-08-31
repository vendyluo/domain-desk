import type { Env } from '../../types';
import { IngestError } from '../../types';
import { hash, resolveContactId } from '../../ingest';

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
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) })
  });
  if (!response.ok) return false; // fail closed when the verifier is unreachable
  const data = (await response.json()) as { success?: boolean };
  return data.success === true;
};

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max + 1) : '';
}

export function originAllowed(origin: string | null, domain: string): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname.toLowerCase();
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
  const messageId = `msg:${messageKey}`;
  const conversationId = `conv:${messageKey}`;
  const contactId = await resolveContactId(env.DB, email);
  const emailRowId = `email:${await hash(email)}`;
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO contacts(id,display_name) VALUES(?,?)').bind(contactId, name || null),
      env.DB.prepare(
        'INSERT OR IGNORE INTO contact_email_addresses(id,contact_id,address,first_seen_at) VALUES(?,?,?,?)'
      ).bind(emailRowId, contactId, email, at),
      env.DB.prepare('UPDATE contacts SET primary_email_id=COALESCE(primary_email_id,?) WHERE id=?').bind(
        emailRowId,
        contactId
      ),
      env.DB.prepare(
        'INSERT INTO conversations(id,mailbox_identity_id,contact_id,subject,needs_attention,created_at,updated_at) VALUES(?,?,?,?,1,?,?)'
      ).bind(conversationId, mailbox.id, contactId, subject || null, at, at),
      env.DB.prepare(
        `INSERT INTO messages
         (id,conversation_id,mailbox_identity_id,contact_id,dedupe_key,references_json,sender_address,sender_name,
          subject,text_body,sent_at,received_at,ingested_at,channel)
         VALUES(?,?,?,?,?,'[]',?,?,?,?,?,?,?,'form')`
      ).bind(
        messageId,
        conversationId,
        mailbox.id,
        contactId,
        dedupeKey,
        email,
        name || null,
        subject || null,
        message,
        at,
        at,
        new Date().toISOString()
      ),
      env.DB.prepare(
        "INSERT INTO message_recipients(id,message_id,mailbox_identity_id,kind,address,display_name) VALUES(?,?,?,'to',?,NULL)"
      ).bind(`rcpt:${messageKey}:0`, messageId, mailbox.id, mailbox.address)
    ]);
  } catch (error) {
    const duplicate = await env.DB.prepare(
      'SELECT id,conversation_id FROM messages WHERE mailbox_identity_id=? AND dedupe_key=?'
    )
      .bind(mailbox.id, dedupeKey)
      .first<{ id: string; conversation_id: string }>();
    if (duplicate) return { id: duplicate.id, conversationId: duplicate.conversation_id, duplicate: true };
    throw error;
  }
  console.log(
    JSON.stringify({ event: 'form_ingested', mailbox_id: mailbox.id, message_id: messageId, channel: 'form' })
  );
  return { id: messageId, conversationId, duplicate: false };
}
