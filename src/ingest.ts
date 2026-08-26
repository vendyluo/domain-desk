import PostalMime from 'postal-mime';
import type { Env } from './types';
import { IngestError } from './types';

const MAX_RAW = 10 * 1024 * 1024;
const normId = (value?: string | null) => value?.trim().replace(/^<|>$/g, '').toLowerCase() || null;
const hex = (data: ArrayBuffer) => [...new Uint8Array(data)].map((x) => x.toString(16).padStart(2, '0')).join('');
type ParsedAddress = { address: string; name: string };

function messageIds(value?: string): string[] {
  if (!value) return [];
  const bracketed = [...value.matchAll(/<([^<>]+)>/g)]
    .map((match) => normId(match[1]))
    .filter((id): id is string => !!id);
  if (bracketed.length) return bracketed;
  const fallback = normId(value);
  return fallback ? [fallback] : [];
}

async function hash(data: ArrayBuffer | ArrayBufferView | string) {
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
  const refs = messageIds(email.references);
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
  const contactId = `contact:${await hash(sender)}`;
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
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('INSERT OR IGNORE INTO contacts(id,display_name) VALUES(?,?)').bind(
      contactId,
      email.from?.name?.trim() || null
    ),
    env.DB.prepare(
      'INSERT OR IGNORE INTO contact_email_addresses(id,contact_id,address,first_seen_at) VALUES(?,?,?,?)'
    ).bind(`email:${await hash(sender)}`, contactId, sender, received),
    env.DB.prepare('UPDATE contacts SET primary_email_id=COALESCE(primary_email_id,?) WHERE id=?').bind(
      `email:${await hash(sender)}`,
      contactId
    ),
    env.DB.prepare(
      'INSERT OR IGNORE INTO conversations(id,mailbox_identity_id,contact_id,subject,created_at,updated_at) VALUES(?,?,?,?,?,?)'
    ).bind(conversationId, mailbox.id, contactId, email.subject || null, received, received),
    env.DB.prepare('UPDATE conversations SET updated_at=?,needs_attention=1 WHERE id=?').bind(received, conversationId),
    env.DB.prepare(
      'INSERT INTO messages(id,conversation_id,mailbox_identity_id,contact_id,dedupe_key,message_id,in_reply_to,references_json,sender_address,sender_name,subject,text_body,sent_at,received_at,ingested_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(
      messageDbId,
      conversationId,
      mailbox.id,
      contactId,
      dedupeKey,
      messageId,
      inReplyTo,
      JSON.stringify(refs),
      sender,
      email.from?.name?.trim() || null,
      email.subject || null,
      email.text || null,
      emailDate(email.date),
      received,
      ingestedAt
    )
  ];
  let ri = 0;
  let hasEnvelopeRecipient = false;
  for (const [kind, recipients] of recipientGroups)
    for (const recipient of recipients) {
      const ownedMailboxId = recipient.address === mailboxAddress ? mailbox.id : null;
      if (ownedMailboxId) hasEnvelopeRecipient = true;
      statements.push(
        env.DB.prepare(
          'INSERT INTO message_recipients(id,message_id,mailbox_identity_id,kind,address,display_name) VALUES(?,?,?,?,?,?)'
        ).bind(
          `rcpt:${messageKey}:${ri++}`,
          messageDbId,
          ownedMailboxId,
          kind,
          recipient.address,
          recipient.name || null
        )
      );
    }
  if (!hasEnvelopeRecipient)
    statements.push(
      env.DB.prepare(
        'INSERT INTO message_recipients(id,message_id,mailbox_identity_id,kind,address,display_name) VALUES(?,?,?,?,?,?)'
      ).bind(`rcpt:${messageKey}:${ri++}`, messageDbId, mailbox.id, 'bcc', mailboxAddress, null)
    );
  for (const row of attachmentRows)
    statements.push(
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
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const duplicate = await env.DB.prepare('SELECT id FROM messages WHERE mailbox_identity_id=? AND dedupe_key=?')
      .bind(mailbox.id, dedupeKey)
      .first<{ id: string }>();
    if (duplicate) return { id: duplicate.id, duplicate: true };
    throw error;
  }
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
