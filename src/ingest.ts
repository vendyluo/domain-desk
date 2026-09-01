import PostalMime from 'postal-mime';
import type { Env } from './types';
import { IngestError } from './types';

const MAX_RAW = 10 * 1024 * 1024;
export const normId = (value?: string | null) => value?.trim().replace(/^<|>$/g, '').toLowerCase() || null;
const hex = (data: ArrayBuffer) => [...new Uint8Array(data)].map((x) => x.toString(16).padStart(2, '0')).join('');
type ParsedAddress = { address: string; name: string };

// Message ids exactly as written by the sender: brackets stripped and trimmed,
// but never case-folded. RFC 5322 msg-ids are case-sensitive, so replies must
// quote them verbatim even though matching uses the normalized form.
function messageIdsRaw(value?: string): string[] {
  if (!value) return [];
  const bracketed = [...value.matchAll(/<([^<>]+)>/g)].map((match) => match[1].trim()).filter((id) => id.length > 0);
  if (bracketed.length) return bracketed;
  const fallback = value.trim().replace(/^<|>$/g, '');
  return fallback ? [fallback] : [];
}

function messageIds(value?: string): string[] {
  return messageIdsRaw(value)
    .map((id) => normId(id))
    .filter((id): id is string => !!id);
}

export async function hash(data: ArrayBuffer | ArrayBufferView | string) {
  const source = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const bytes =
    source instanceof ArrayBuffer
      ? source
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice().buffer;
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

function addresses(
  values: Array<{ address?: string; name: string; group?: ParsedAddress[] }> | undefined
): ParsedAddress[] {
  return (values ?? [])
    .flatMap((value) =>
      value.address
        ? [
            {
              address: value.address.trim().toLowerCase(),
              name: value.name?.trim() || ''
            }
          ]
        : (value.group ?? []).map((member) => ({
            address: member.address.trim().toLowerCase(),
            name: member.name?.trim() || ''
          }))
    )
    .filter((value) => value.address);
}

function emailDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function htmlToText(html: string): string {
  const codePoint = (value: number) => (value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ' ');
  const decoded = html
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|li|tr|table|h[1-6]|blockquote|pre|ul|ol|section|article|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
  return decoded
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Resolve an email address to its canonical contact: follow the merge chain to the
// surviving contact, or derive the deterministic id for a brand-new address.
export async function resolveContactId(db: Env['DB'], address: string): Promise<string> {
  // The depth bound keeps a corrupted merge cycle from spinning forever: the
  // walk yields no survivor, and the caller falls back to the deterministic id
  // so mail is still filed instead of failing permanently.
  const canonical = await db
    .prepare(
      `WITH RECURSIVE canon(id,merged_into_id,depth) AS (
         SELECT c.id,c.merged_into_id,0 FROM contact_email_addresses ce JOIN contacts c ON c.id=ce.contact_id WHERE ce.address=?
         UNION ALL
         SELECT c.id,c.merged_into_id,canon.depth+1 FROM contacts c JOIN canon ON c.id=canon.merged_into_id WHERE canon.depth < 32
       ) SELECT id FROM canon WHERE merged_into_id IS NULL`
    )
    .bind(address)
    .first<{ id: string }>();
  return canonical?.id ?? `contact:${await hash(address)}`;
}

export async function readBounded(stream: ReadableStream<Uint8Array>, limit = MAX_RAW): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new IngestError('message_too_large', `Message exceeds ${limit} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}

export type InboundRecipient = {
  kind: 'to' | 'cc' | 'bcc';
  address: string;
  name: string | null;
  mailboxIdentityId: string | null;
};

/** One inbound message, normalized by its channel and ready to persist. */
export type InboundRecord = {
  mailboxId: string;
  contactId: string;
  senderAddress: string;
  senderName: string | null;
  conversationId: string;
  messageId: string;
  messageKey: string;
  dedupeKey: string;
  subject: string | null;
  textBody: string | null;
  sentAt: string | null;
  receivedAt: string;
  ingestedAt: string;
  channel: 'email' | 'form';
  rfcMessageId?: string | null;
  rfcMessageIdRaw?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  referencesRaw?: string[];
  recipients: InboundRecipient[];
};

/**
 * Write one inbound message and everything it implies: the canonical contact and
 * its address, the conversation (created or touched), the message, and its
 * recipients. Every inbound channel goes through here so the contact-identity
 * and attribution invariants have exactly one implementation. `extra` carries
 * channel-specific rows (attachments) into the same atomic batch. A losing
 * concurrent duplicate is recovered by re-reading the dedupe key.
 */
export async function persistInbound(
  db: Env['DB'],
  record: InboundRecord,
  extra: D1PreparedStatement[] = []
): Promise<{ id: string; conversationId: string; duplicate: boolean }> {
  const senderEmailId = `email:${await hash(record.senderAddress)}`;
  const statements: D1PreparedStatement[] = [
    db.prepare('INSERT OR IGNORE INTO contacts(id,display_name) VALUES(?,?)').bind(record.contactId, record.senderName),
    db
      .prepare('INSERT OR IGNORE INTO contact_email_addresses(id,contact_id,address,first_seen_at) VALUES(?,?,?,?)')
      .bind(senderEmailId, record.contactId, record.senderAddress, record.receivedAt),
    db
      .prepare('UPDATE contacts SET primary_email_id=COALESCE(primary_email_id,?) WHERE id=?')
      .bind(senderEmailId, record.contactId),
    db
      .prepare(
        'INSERT OR IGNORE INTO conversations(id,mailbox_identity_id,contact_id,subject,created_at,updated_at) VALUES(?,?,?,?,?,?)'
      )
      .bind(
        record.conversationId,
        record.mailboxId,
        record.contactId,
        record.subject,
        record.receivedAt,
        record.receivedAt
      ),
    db
      .prepare('UPDATE conversations SET updated_at=?,needs_attention=1 WHERE id=?')
      .bind(record.receivedAt, record.conversationId),
    db
      .prepare(
        `INSERT INTO messages
         (id,conversation_id,mailbox_identity_id,contact_id,dedupe_key,message_id,message_id_raw,in_reply_to,
          references_json,references_raw_json,sender_address,sender_name,subject,text_body,sent_at,received_at,
          ingested_at,channel)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        record.messageId,
        record.conversationId,
        record.mailboxId,
        record.contactId,
        record.dedupeKey,
        record.rfcMessageId ?? null,
        record.rfcMessageIdRaw ?? null,
        record.inReplyTo ?? null,
        JSON.stringify(record.references ?? []),
        JSON.stringify(record.referencesRaw ?? []),
        record.senderAddress,
        record.senderName,
        record.subject,
        record.textBody,
        record.sentAt,
        record.receivedAt,
        record.ingestedAt,
        record.channel
      )
  ];
  record.recipients.forEach((recipient, index) =>
    statements.push(
      db
        .prepare(
          'INSERT INTO message_recipients(id,message_id,mailbox_identity_id,kind,address,display_name) VALUES(?,?,?,?,?,?)'
        )
        .bind(
          `rcpt:${record.messageKey}:${index}`,
          record.messageId,
          recipient.mailboxIdentityId,
          recipient.kind,
          recipient.address,
          recipient.name
        )
    )
  );
  try {
    await db.batch([...statements, ...extra]);
  } catch (error) {
    const duplicate = await db
      .prepare('SELECT id,conversation_id FROM messages WHERE mailbox_identity_id=? AND dedupe_key=?')
      .bind(record.mailboxId, record.dedupeKey)
      .first<{ id: string; conversation_id: string }>();
    if (duplicate) return { id: duplicate.id, conversationId: duplicate.conversation_id, duplicate: true };
    throw error;
  }
  return { id: record.messageId, conversationId: record.conversationId, duplicate: false };
}

export async function ingestRaw(
  env: Env,
  envelopeTo: string,
  raw: ArrayBuffer,
  receivedAt = new Date()
): Promise<{ id: string; duplicate: boolean }> {
  const mailboxAddress = envelopeTo.trim().toLowerCase();
  const mailbox = await env.DB.prepare('SELECT id FROM mailbox_identities WHERE address = ? COLLATE NOCASE')
    .bind(mailboxAddress)
    .first<{ id: string }>();
  if (!mailbox) throw new IngestError('unknown_mailbox', `No configured mailbox for ${mailboxAddress}`);
  let email: Awaited<ReturnType<PostalMime['parse']>>;
  try {
    email = await new PostalMime().parse(raw);
  } catch (error) {
    throw new IngestError('malformed_mime', error instanceof Error ? error.message : 'MIME parse failed');
  }
  const sender = email.from?.address?.trim().toLowerCase();
  if (!sender) throw new IngestError('malformed_mime', 'A valid From address is required');
  const messageId = normId(email.messageId);
  const messageIdRaw = email.messageId?.trim().replace(/^<|>$/g, '') || null;
  const refs = messageIds(email.references);
  const refsRaw = messageIdsRaw(email.references);
  const replyIds = messageIds(email.inReplyTo);
  const inReplyTo = replyIds.at(-1) ?? null;
  const recipientGroups = [
    ['to', addresses(email.to)],
    ['cc', addresses(email.cc)],
    ['bcc', addresses(email.bcc)]
  ] as const;
  const attachmentInputs = await Promise.all(
    email.attachments.map(async (attachment) => {
      const content =
        typeof attachment.content === 'string' ? new TextEncoder().encode(attachment.content) : attachment.content;
      return { attachment, content, digest: await hash(content) };
    })
  );
  const contentFingerprint = await hash(
    JSON.stringify({
      sender,
      senderName: email.from?.name?.trim() || '',
      recipients: recipientGroups.map(([kind, values]) => [kind, values]),
      subject: email.subject || '',
      sentAt: emailDate(email.date),
      textHash: await hash(email.text || ''),
      htmlHash: await hash(email.html || ''),
      refs,
      replyIds,
      attachments: attachmentInputs.map(({ attachment, content, digest }) => ({
        filename: attachment.filename || '',
        mimeType: attachment.mimeType || '',
        disposition: attachment.disposition,
        contentId: attachment.contentId || '',
        size: content.byteLength,
        digest
      }))
    })
  );
  const dedupeKey = messageId ? `mid:${messageId}` : `content:${contentFingerprint}`;
  const existing = await env.DB.prepare('SELECT id FROM messages WHERE mailbox_identity_id=? AND dedupe_key=?')
    .bind(mailbox.id, dedupeKey)
    .first<{ id: string }>();
  if (existing) return { id: existing.id, duplicate: true };
  const evidence = [...refs, ...replyIds];
  let conversationId: string | undefined;
  for (const ref of [...evidence].reverse()) {
    const parent = await env.DB.prepare(
      'SELECT conversation_id FROM messages WHERE mailbox_identity_id=? AND message_id=?'
    )
      .bind(mailbox.id, ref)
      .first<{ conversation_id: string }>();
    if (parent) {
      conversationId = parent.conversation_id;
      break;
    }
  }
  const messageKey = await hash(`${mailbox.id}\n${dedupeKey}`);
  const messageDbId = `msg:${messageKey}`;
  conversationId ??= `conv:${messageKey}`;
  const contactId = await resolveContactId(env.DB, sender);
  const received = receivedAt.toISOString();
  const attachmentRows: {
    id: string;
    key: string;
    name?: string;
    type: string;
    size: number;
    digest: string;
    contentId?: string;
    disposition: 'attachment' | 'inline' | null;
  }[] = [];
  try {
    for (let i = 0; i < attachmentInputs.length; i++) {
      const { attachment, content, digest } = attachmentInputs[i];
      const key = `attachments/${mailbox.id}/${messageKey}/${i}-${digest}`;
      await env.ATTACHMENTS.put(key, content, {
        httpMetadata: {
          contentType: attachment.mimeType || 'application/octet-stream'
        }
      });
      attachmentRows.push({
        id: `att:${messageKey}:${i}`,
        key,
        name: attachment.filename || undefined,
        type: attachment.mimeType || 'application/octet-stream',
        size: content.byteLength,
        digest,
        contentId: attachment.contentId,
        disposition: attachment.disposition
      });
    }
  } catch (error) {
    throw new IngestError('attachment_storage_failed', error instanceof Error ? error.message : 'R2 write failed');
  }
  const ingestedAt = new Date().toISOString();
  // An authored text/plain part is stored verbatim; when a message is HTML-only,
  // a plain-text extraction of the HTML is stored instead. Raw HTML is never
  // stored or rendered, and the dedupe fingerprint keeps hashing the raw parts.
  const textBody = email.text?.trim() ? email.text : htmlToText(email.html ?? '') || null;
  const recipients: InboundRecipient[] = [];
  let hasEnvelopeRecipient = false;
  for (const [kind, group] of recipientGroups)
    for (const recipient of group) {
      const ownedMailboxId = recipient.address === mailboxAddress ? mailbox.id : null;
      if (ownedMailboxId) hasEnvelopeRecipient = true;
      recipients.push({
        kind,
        address: recipient.address,
        name: recipient.name || null,
        mailboxIdentityId: ownedMailboxId
      });
    }
  // The envelope recipient is canonical attribution even when no header names it.
  if (!hasEnvelopeRecipient)
    recipients.push({ kind: 'bcc', address: mailboxAddress, name: null, mailboxIdentityId: mailbox.id });

  const attachmentStatements = attachmentRows.map((row) =>
    env.DB.prepare(
      'INSERT INTO attachments(id,message_id,filename,media_type,size,content_hash,object_key,content_id,disposition) VALUES(?,?,?,?,?,?,?,?,?)'
    ).bind(
      row.id,
      messageDbId,
      row.name || null,
      row.type,
      row.size,
      row.digest,
      row.key,
      row.contentId || null,
      row.disposition
    )
  );
  const persisted = await persistInbound(
    env.DB,
    {
      mailboxId: mailbox.id,
      contactId,
      senderAddress: sender,
      senderName: email.from?.name?.trim() || null,
      conversationId,
      messageId: messageDbId,
      messageKey,
      dedupeKey,
      subject: email.subject || null,
      textBody,
      sentAt: emailDate(email.date),
      receivedAt: received,
      ingestedAt,
      channel: 'email',
      rfcMessageId: messageId,
      rfcMessageIdRaw: messageIdRaw,
      inReplyTo,
      references: refs,
      referencesRaw: refsRaw,
      recipients
    },
    attachmentStatements
  );
  if (persisted.duplicate) return { id: persisted.id, duplicate: true };
  console.log(
    JSON.stringify({
      event: 'email_ingested',
      mailbox_id: mailbox.id,
      message_id: messageDbId,
      attachment_count: attachmentRows.length
    })
  );
  return { id: messageDbId, duplicate: false };
}
