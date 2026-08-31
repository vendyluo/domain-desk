import type { Env } from '../../types';

export type InboxFilters = {
  q?: string;
  state?: string;
  product?: string;
  domain?: string;
  mailbox?: string;
};
export type InboxRow = {
  id: string;
  subject: string | null;
  needs_attention: number;
  updated_at: string;
  sender_address: string;
  sender_name: string | null;
  preview: string | null;
  mailbox: string;
  mailbox_id: string;
  product: string;
  product_id: string;
  domain: string;
  domain_id: string;
  attachment_count: number;
};

export async function listInbox(db: Env['DB'], filters: InboxFilters) {
  const where: string[] = [];
  const values: string[] = [];
  if (filters.state === 'attention' || filters.state === 'handled') {
    where.push('c.needs_attention=?');
    values.push(filters.state === 'attention' ? '1' : '0');
  }
  for (const [key, column] of [
    ['product', 'p.id'],
    ['domain', 'd.id'],
    ['mailbox', 'mi.id']
  ] as const)
    if (filters[key]) {
      where.push(`${column}=?`);
      values.push(filters[key]!);
    }
  if (filters.q?.trim()) {
    where.push(
      "(c.subject LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM messages ms WHERE ms.conversation_id=c.id AND (ms.sender_address LIKE ? ESCAPE '\\' OR ms.sender_name LIKE ? ESCAPE '\\' OR ms.text_body LIKE ? ESCAPE '\\')))"
    );
    const q = `%${filters.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
    values.push(q, q, q, q);
  }
  const sql = `SELECT c.id,c.subject,c.needs_attention,c.updated_at,m.sender_address,m.sender_name,substr(replace(replace(m.text_body,char(10),' '),char(13),' '),1,180) preview,mi.address mailbox,mi.id mailbox_id,p.name product,p.id product_id,d.name domain,d.id domain_id,(SELECT count(*) FROM attachments a JOIN messages am ON am.id=a.message_id WHERE am.conversation_id=c.id) attachment_count FROM conversations c JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id JOIN messages m ON m.id=(SELECT id FROM messages WHERE conversation_id=c.id ORDER BY received_at DESC,id DESC LIMIT 1) ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.updated_at DESC,c.id DESC`;
  const rows = await db
    .prepare(sql)
    .bind(...values)
    .all<InboxRow>();
  const options = await db
    .prepare(
      'SELECT mi.id mailbox_id,mi.address mailbox,p.id product_id,p.name product,d.id domain_id,d.name domain FROM mailbox_identities mi JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id ORDER BY p.name,mi.address'
    )
    .all<Record<string, string>>();
  return { rows: rows.results, options: options.results };
}

export async function getConversation(db: Env['DB'], id: string) {
  const conversation = await db
    .prepare(
      `SELECT c.id,c.subject,c.needs_attention,c.updated_at,c.contact_id,mi.address mailbox,p.name product,d.name domain,ct.display_name,ce.address contact_email,ct.created_at contact_created_at,(SELECT min(received_at) FROM messages WHERE contact_id=c.contact_id) first_seen,(SELECT max(received_at) FROM messages WHERE contact_id=c.contact_id) last_seen FROM conversations c JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id JOIN contacts ct ON ct.id=c.contact_id JOIN contact_email_addresses ce ON ce.id=ct.primary_email_id WHERE c.id=?`
    )
    .bind(id)
    .first<Record<string, string | number | null>>();
  if (!conversation) return null;
  const messages = await db
    .prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY received_at,id')
    .bind(id)
    .all<Record<string, string | null>>();
  const recipients = await db
    .prepare(
      'SELECT mr.* FROM message_recipients mr JOIN messages m ON m.id=mr.message_id WHERE m.conversation_id=? ORDER BY mr.message_id,mr.kind,mr.id'
    )
    .bind(id)
    .all<Record<string, string | null>>();
  const attachments = await db
    .prepare(
      'SELECT a.* FROM attachments a JOIN messages m ON m.id=a.message_id WHERE m.conversation_id=? ORDER BY a.message_id,a.id'
    )
    .bind(id)
    .all<Record<string, string | number | null>>();
  return {
    conversation,
    messages: messages.results,
    recipients: recipients.results,
    attachments: attachments.results
  };
}

export async function setHandled(db: Env['DB'], id: string, needsAttention: boolean, now = new Date()) {
  const row = await db
    .prepare('SELECT needs_attention,contact_id FROM conversations WHERE id=?')
    .bind(id)
    .first<{ needs_attention: number; contact_id: string }>();
  if (!row) return false;
  if (Boolean(row.needs_attention) === needsAttention) return true;
  const at = now.toISOString();
  await db.batch([
    db.prepare('UPDATE conversations SET needs_attention=? WHERE id=?').bind(needsAttention ? 1 : 0, id),
    db
      .prepare(
        'INSERT INTO activity_events(id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,source_type,source_id,prior_state_json,new_state_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
      )
      .bind(
        `event:${crypto.randomUUID()}`,
        needsAttention ? 'conversation.reopened' : 'conversation.handled',
        'owner',
        at,
        'conversation',
        id,
        row.contact_id,
        'conversation',
        id,
        JSON.stringify({ needs_attention: Boolean(row.needs_attention) }),
        JSON.stringify({ needs_attention: needsAttention })
      )
  ]);
  return true;
}
