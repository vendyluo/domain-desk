import type { Env } from '../../types';
import { normId } from '../../ingest';

const MAX_REPLY = 50_000;
const MAX_REFERENCES = 20;

type ConversationRow = {
  id: string;
  subject: string | null;
  contact_id: string;
  mailbox_identity_id: string;
  mailbox_address: string;
  mailbox_name: string | null;
};
type InboundRow = {
  sender_address: string;
  sender_name: string | null;
  message_id: string | null;
  references_json: string;
};

function sendEvent(
  db: Env['DB'],
  type: string,
  at: string,
  conversationId: string,
  contactId: string,
  messageId: string,
  state: object,
  reason: string | null = null
) {
  return db
    .prepare(
      `INSERT INTO activity_events
       (id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,source_type,source_id,new_state_json,reason)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      `event:${crypto.randomUUID()}`,
      type,
      'owner',
      at,
      'conversation',
      conversationId,
      contactId,
      'message',
      messageId,
      JSON.stringify(state),
      reason
    );
}

export async function sendReply(
  env: Pick<Env, 'DB' | 'EMAIL'>,
  conversationId: string,
  body: unknown,
  now = new Date()
): Promise<{ id: string }> {
  if (typeof body !== 'string' || !body.trim()) throw new Error('Reply text is required.');
  const text = body.trim();
  if (text.length > MAX_REPLY) throw new Error('Reply text is too long.');
  if (!env.EMAIL) {
    throw new Error('Outbound email is not configured. Deploy with the EMAIL send binding and enable Email Sending.');
  }
  const db = env.DB;
  const conversation = await db
    .prepare(
      `SELECT c.id,c.subject,c.contact_id,mi.id mailbox_identity_id,mi.address mailbox_address,mi.display_name mailbox_name
       FROM conversations c JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id WHERE c.id=?`
    )
    .bind(conversationId)
    .first<ConversationRow>();
  if (!conversation) throw new Error('Conversation not found.');
  const inbound = await db
    .prepare(
      `SELECT sender_address,sender_name,message_id,references_json FROM messages
       WHERE conversation_id=? AND direction='inbound' ORDER BY received_at DESC,id DESC LIMIT 1`
    )
    .bind(conversationId)
    .first<InboundRow>();
  if (!inbound) throw new Error('This conversation has no inbound message to reply to.');

  const at = now.toISOString();
  const id = `msg:out:${crypto.randomUUID()}`;
  const subject = conversation.subject
    ? /^re:/i.test(conversation.subject.trim())
      ? conversation.subject
      : `Re: ${conversation.subject}`
    : 'Re: (no subject)';
  const references: string[] = JSON.parse(inbound.references_json || '[]');
  if (inbound.message_id && !references.includes(inbound.message_id)) references.push(inbound.message_id);
  const headers: Record<string, string> = {};
  if (inbound.message_id) headers['In-Reply-To'] = `<${inbound.message_id}>`;
  if (references.length)
    headers['References'] = references
      .slice(-MAX_REFERENCES)
      .map((ref) => `<${ref}>`)
      .join(' ');

  // The intent row commits before the external send: if the process dies between
  // send and confirmation, the message stays visibly 'sending' (state unknown)
  // instead of silently losing the record of an external effect.
  await db.batch([
    db
      .prepare(
        `INSERT INTO messages
         (id,conversation_id,mailbox_identity_id,contact_id,dedupe_key,in_reply_to,references_json,
          sender_address,sender_name,subject,text_body,sent_at,received_at,ingested_at,direction,delivery_status)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'outbound','sending')`
      )
      .bind(
        id,
        conversation.id,
        conversation.mailbox_identity_id,
        conversation.contact_id,
        `out:${id}`,
        inbound.message_id,
        JSON.stringify(references),
        conversation.mailbox_address,
        conversation.mailbox_name,
        subject,
        text,
        at,
        at,
        at
      ),
    db
      .prepare(
        "INSERT INTO message_recipients(id,message_id,mailbox_identity_id,kind,address,display_name) VALUES(?,?,NULL,'to',?,?)"
      )
      .bind(`rcpt:${id}`, id, inbound.sender_address, inbound.sender_name),
    db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').bind(at, conversation.id),
    sendEvent(db, 'message.send_requested', at, conversation.id, conversation.contact_id, id, {
      to: inbound.sender_address,
      subject
    })
  ]);

  try {
    const result = await env.EMAIL.send({
      from: { email: conversation.mailbox_address, name: conversation.mailbox_name || '' },
      to: inbound.sender_name ? { email: inbound.sender_address, name: inbound.sender_name } : inbound.sender_address,
      subject,
      text,
      ...(Object.keys(headers).length ? { headers } : {})
    });
    const confirmedAt = new Date().toISOString();
    await db.batch([
      db
        .prepare("UPDATE messages SET delivery_status='sent',message_id=? WHERE id=?")
        .bind(normId(result?.messageId), id),
      sendEvent(db, 'message.sent', confirmedAt, conversation.id, conversation.contact_id, id, {
        to: inbound.sender_address,
        message_id: normId(result?.messageId)
      })
    ]);
    return { id };
  } catch (error) {
    const code =
      typeof (error as { code?: unknown })?.code === 'string'
        ? String((error as { code: string }).code)
        : error instanceof Error
          ? error.message
          : 'send_failed';
    const failedAt = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE messages SET delivery_status='failed',delivery_error=? WHERE id=?").bind(code, id),
      sendEvent(
        db,
        'message.send_failed',
        failedAt,
        conversation.id,
        conversation.contact_id,
        id,
        { to: inbound.sender_address },
        code
      )
    ]);
    throw new Error(`Send failed: ${code}`, { cause: error });
  }
}
