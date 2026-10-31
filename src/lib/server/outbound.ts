import type { Env } from '../../types';
import { normId } from '../../ingest';

type ReplyContext = {
  conversation_id: string;
  contact_id: string;
  mailbox_identity_id: string;
  from: string;
  from_name: string | null;
  to: string;
  to_name: string | null;
  subject: string;
  parent: string | null;
  references: string[];
  inbound_id: string;
};
export type ReplyDraft = {
  id: string;
  conversation_id: string;
  state: 'draft' | 'approved' | 'sending' | 'accepted' | 'failed' | 'indeterminate' | 'cancelled';
  body: string;
  context_json: string;
  content_hash: string;
  approved_hash: string | null;
  message_row_id: string | null;
  provider_id: string | null;
  error_code: string | null;
  evidence: string | null;
  updated_at: string;
};

async function context(db: Env['DB'], conversationId: string): Promise<ReplyContext> {
  const row = await db
    .prepare(
      `SELECT c.id conversation_id,c.contact_id,c.subject,
    mi.id mailbox_identity_id,mi.address sender,mi.display_name sender_name,
    m.id inbound_id,m.sender_address,m.sender_name recipient_name,m.message_id,m.message_id_raw,
    m.references_json,m.references_raw_json
    FROM conversations c JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id
    JOIN messages m ON m.id=(SELECT id FROM messages WHERE conversation_id=c.id AND direction='inbound'
    ORDER BY received_at DESC,id DESC LIMIT 1) WHERE c.id=?`
    )
    .bind(conversationId)
    .first<{
      conversation_id: string;
      contact_id: string;
      subject: string | null;
      mailbox_identity_id: string;
      sender: string;
      sender_name: string | null;
      inbound_id: string;
      sender_address: string;
      recipient_name: string | null;
      message_id: string | null;
      message_id_raw: string | null;
      references_json: string;
      references_raw_json: string | null;
    }>();
  if (!row) throw new Error('Conversation not found or has no inbound message.');
  const parent = row.message_id_raw ?? row.message_id;
  const references: string[] = JSON.parse(row.references_raw_json || row.references_json || '[]');
  if (parent && !references.includes(parent)) references.push(parent);
  return {
    conversation_id: row.conversation_id,
    contact_id: row.contact_id,
    mailbox_identity_id: row.mailbox_identity_id,
    from: row.sender,
    from_name: row.sender_name,
    to: row.sender_address,
    to_name: row.recipient_name,
    subject: row.subject ? (/^re:/i.test(row.subject.trim()) ? row.subject : `Re: ${row.subject}`) : 'Re: (no subject)',
    parent,
    references: references.slice(-20),
    inbound_id: row.inbound_id
  };
}

async function hash(body: string, ctx: ReplyContext) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ body, ctx })));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

function event(db: Env['DB'], draft: ReplyDraft, type: string, at: string, detail: object) {
  return db
    .prepare(
      `INSERT INTO activity_events
    (id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,source_type,source_id,new_state_json)
    SELECT ?,?,'owner',?,'conversation',id,contact_id,'conversation',id,? FROM conversations WHERE id=? AND changes()=1`
    )
    .bind(
      `event:${crypto.randomUUID()}`,
      type,
      at,
      JSON.stringify({ draft_id: draft.id, ...detail }),
      draft.conversation_id
    );
}

async function getDraft(db: Env['DB'], conversationId: string, id: unknown) {
  if (typeof id !== 'string') throw new Error('Select a saved draft.');
  const row = await db
    .prepare('SELECT * FROM reply_drafts WHERE id=? AND conversation_id=?')
    .bind(id, conversationId)
    .first<ReplyDraft>();
  if (!row) throw new Error('Draft not found.');
  return row;
}

export async function listReplies(db: Env['DB'], conversationId: string) {
  const rows = await db
    .prepare('SELECT * FROM reply_drafts WHERE conversation_id=? ORDER BY created_at,id')
    .bind(conversationId)
    .all<ReplyDraft>();
  return rows.results.map((row) => ({ ...row, context: JSON.parse(row.context_json) as Partial<ReplyContext> }));
}

export async function saveReplyDraft(db: Env['DB'], conversationId: string, body: unknown, id: unknown = null) {
  if (typeof body !== 'string' || !body.trim()) throw new Error('Reply text is required.');
  const text = body.trim();
  if (text.length > 50_000) throw new Error('Reply text is too long.');
  const ctx = await context(db, conversationId);
  const contentHash = await hash(text, ctx);
  const at = new Date().toISOString();
  const draftId = typeof id === 'string' && id ? id : `reply:${crypto.randomUUID()}`;
  const result = id
    ? await db
        .prepare(
          `UPDATE reply_drafts SET body=?,context_json=?,content_hash=?,
    approved_hash=NULL,state='draft',updated_at=? WHERE id=? AND conversation_id=? AND state IN ('draft','approved')`
        )
        .bind(text, JSON.stringify(ctx), contentHash, at, draftId, conversationId)
        .run()
    : await db
        .prepare(
          `INSERT INTO reply_drafts(id,conversation_id,state,body,context_json,content_hash,created_at,updated_at)
      SELECT ?,?,'draft',?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM reply_drafts
      WHERE conversation_id=? AND state IN ('draft','approved','sending','indeterminate'))`
        )
        .bind(draftId, conversationId, text, JSON.stringify(ctx), contentHash, at, at, conversationId)
        .run();
  if (!result.meta.changes)
    throw new Error('An existing draft or unresolved send blocks this change. Refresh the conversation.');
  return getDraft(db, conversationId, draftId);
}

export async function approveReply(db: Env['DB'], conversationId: string, id: unknown, reviewedHash: unknown) {
  const draft = await getDraft(db, conversationId, id);
  if (
    reviewedHash !== draft.content_hash ||
    draft.content_hash !== (await hash(draft.body, await context(db, conversationId)))
  )
    throw new Error('Reply context changed. Save and review the draft again.');
  const at = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        "UPDATE reply_drafts SET state='approved',approved_hash=content_hash,updated_at=? WHERE id=? AND state='draft' AND content_hash=?"
      )
      .bind(at, draft.id, reviewedHash),
    db
      .prepare(
        `INSERT INTO activity_events(id,event_type,actor,occurred_at,subject_type,subject_id,source_type,source_id,new_state_json)
      SELECT ?,'reply.approved','owner',?,'conversation',?,'conversation',?,? WHERE changes()=1`
      )
      .bind(
        `event:${crypto.randomUUID()}`,
        at,
        conversationId,
        conversationId,
        JSON.stringify({ draft_id: draft.id, content_hash: reviewedHash })
      )
  ]);
  if (!result[0].meta.changes) throw new Error('Draft changed or is no longer awaiting approval.');
}

export async function cancelReply(db: Env['DB'], conversationId: string, id: unknown) {
  const draft = await getDraft(db, conversationId, id);
  const result = await db
    .prepare("UPDATE reply_drafts SET state='cancelled',updated_at=? WHERE id=? AND state IN ('draft','approved')")
    .bind(new Date().toISOString(), draft.id)
    .run();
  if (!result.meta.changes) throw new Error('Only an unsent draft can be cancelled.');
}

// Only documented validation/policy rejections imply confirmed non-acceptance.
// Unknown codes, transport errors, and internal errors are never retry permission.
const REJECTED = new Set([
  'E_SENDER_NOT_VERIFIED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_RECIPIENT_SUPPRESSED',
  'E_VALIDATION_ERROR',
  'E_FIELD_MISSING',
  'E_RECIPIENT_NOT_ALLOWED',
  'E_CONTENT_TOO_LARGE',
  'E_TOO_MANY_RECIPIENTS',
  'E_TOO_MANY_ATTACHMENTS',
  'E_RATE_LIMIT_EXCEEDED',
  'E_DAILY_LIMIT_EXCEEDED',
  'E_HEADER_NOT_ALLOWED',
  'E_HEADER_USE_API_FIELD',
  'E_HEADER_VALUE_INVALID',
  'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID',
  'E_HEADERS_TOO_LARGE',
  'E_HEADERS_TOO_MANY'
]);

export async function sendReply(
  env: Pick<Env, 'DB' | 'EMAIL'>,
  conversationId: string,
  id: unknown,
  approvedHash: unknown,
  now = new Date()
) {
  if (!env.EMAIL) throw new Error('Outbound email is not configured.');
  const db = env.DB;
  const draft = await getDraft(db, conversationId, id);
  if (draft.state !== 'approved' || approvedHash !== draft.approved_hash)
    throw new Error('This reply is not approved or was already attempted.');
  const ctx = await context(db, conversationId);
  if ((await hash(draft.body, ctx)) !== draft.approved_hash)
    throw new Error('Reply context changed. Save and review the draft again.');
  const at = now.toISOString();
  const messageId = `msg:out:${draft.id}`;
  // A single atomic claim also commits the intent and audit BEFORE any provider call.
  // Unique message IDs force concurrent/stale claims to roll back the whole batch.
  const claimed = await db.batch([
    db
      .prepare(
        `UPDATE reply_drafts SET state='sending',started_at=?,updated_at=?,message_row_id=?
      WHERE id=? AND state='approved' AND approved_hash=? AND content_hash=?
      AND NOT EXISTS(SELECT 1 FROM reply_drafts WHERE conversation_id=? AND state IN ('sending','indeterminate'))`
      )
      .bind(at, at, messageId, draft.id, approvedHash, approvedHash, conversationId),
    db
      .prepare(
        `INSERT INTO messages(id,conversation_id,mailbox_identity_id,contact_id,dedupe_key,in_reply_to,
      references_json,references_raw_json,sender_address,sender_name,subject,text_body,sent_at,received_at,ingested_at,direction,delivery_status)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,'outbound','sending' WHERE changes()=1`
      )
      .bind(
        messageId,
        conversationId,
        ctx.mailbox_identity_id,
        ctx.contact_id,
        `out:${draft.id}`,
        normId(ctx.parent),
        JSON.stringify(ctx.references.map(normId).filter(Boolean)),
        JSON.stringify(ctx.references),
        ctx.from,
        ctx.from_name,
        ctx.subject,
        draft.body,
        at,
        at
      ),
    db
      .prepare(
        `INSERT INTO message_recipients(id,message_id,kind,address,display_name)
      SELECT ?,?,'to',?,? WHERE changes()=1`
      )
      .bind(`rcpt:${messageId}`, messageId, ctx.to, ctx.to_name),
    db.prepare('UPDATE conversations SET updated_at=? WHERE id=? AND changes()=1').bind(at, conversationId),
    event(db, draft, 'reply.send_requested', at, { content_hash: approvedHash })
  ]);
  if (!claimed[0].meta.changes) throw new Error('Reply already attempted or another send is unresolved.');
  draft.message_row_id = messageId;
  const headers: Record<string, string> = {};
  if (ctx.parent) headers['In-Reply-To'] = `<${ctx.parent}>`;
  if (ctx.references.length) headers.References = ctx.references.map((ref) => `<${ref}>`).join(' ');
  let providerId: string;
  try {
    const result = await env.EMAIL.send({
      from: { email: ctx.from, name: ctx.from_name || '' },
      to: ctx.to_name ? { email: ctx.to, name: ctx.to_name } : ctx.to,
      subject: ctx.subject,
      text: draft.body,
      ...(Object.keys(headers).length ? { headers } : {})
    });
    if (!result?.messageId || !normId(result.messageId)) throw new Error('Missing provider ID');
    providerId = result.messageId;
  } catch (error) {
    const candidate = (error as { code?: unknown })?.code;
    const code =
      typeof candidate === 'string' && /^E_[A-Z_]{1,80}$/.test(candidate) ? candidate : 'provider_response_unknown';
    const state = REJECTED.has(code) ? 'failed' : 'indeterminate';
    await finish(db, draft, state, null, code);
    throw new Error(
      state === 'failed'
        ? `Provider rejected this reply: ${code}. Correct the cause before creating a new draft.`
        : `Send outcome unknown (${code}). Do not resend; reconcile provider evidence first.`,
      { cause: error }
    );
  }
  // Deliberately OUTSIDE the provider catch: a failed commit cannot turn acceptance
  // into a confirmed rejection. The persisted sending claim blocks every retry.
  try {
    await finish(db, draft, 'accepted', providerId, null);
  } catch {
    console.error(
      JSON.stringify({ event: 'reply.acceptance_record_failed', draft_id: draft.id, provider_id: providerId })
    );
    throw new Error(
      `Provider accepted the reply (${providerId}), but recording failed. Do not resend; reconcile this provider ID.`
    );
  }
  return { id: messageId };
}

async function finish(
  db: Env['DB'],
  draft: ReplyDraft,
  state: 'accepted' | 'failed' | 'indeterminate',
  providerId: string | null,
  code: string | null,
  evidence: string | null = null
) {
  const at = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE reply_drafts SET state=?,provider_id=?,error_code=?,evidence=?,finished_at=?,updated_at=?
      WHERE id=? AND state IN ('sending','indeterminate')`
      )
      .bind(state, providerId, code, evidence, at, at, draft.id),
    db
      .prepare(
        `UPDATE messages SET delivery_status=?,delivery_error=?,message_id=?,message_id_raw=?,sent_at=?
      WHERE id=? AND changes()=1`
      )
      .bind(
        state === 'accepted' ? 'sent' : state === 'failed' ? 'failed' : 'sending',
        code,
        normId(providerId),
        providerId?.replace(/^<|>$/g, '') ?? null,
        state === 'accepted' ? at : null,
        draft.message_row_id
      ),
    event(db, draft, evidence ? 'reply.reconciled' : `reply.${state}`, at, {
      state,
      provider_id: providerId,
      code,
      evidence
    })
  ]);
  if (!result[0].meta.changes) throw new Error('Reply outcome changed; refresh before reconciling.');
}

export async function reconcileReply(
  db: Env['DB'],
  conversationId: string,
  id: unknown,
  outcome: unknown,
  evidence: unknown,
  providerId: unknown
) {
  const draft = await getDraft(db, conversationId, id);
  if (!['sending', 'indeterminate'].includes(draft.state))
    throw new Error('Only an unresolved attempt can be reconciled.');
  // Never turn an in-flight provider call into retry permission. An indeterminate
  // exception is settled; a crashed sending call needs operator investigation first.
  if (draft.state === 'sending') {
    const row = await db
      .prepare('SELECT started_at FROM reply_drafts WHERE id=?')
      .bind(draft.id)
      .first<{ started_at: string }>();
    if (!row || Date.now() - Date.parse(row.started_at) < 15 * 60_000)
      throw new Error('Wait at least 15 minutes and verify the provider attempt has ended before reconciling.');
  }
  if (outcome !== 'accepted' && outcome !== 'failed') throw new Error('Choose the evidenced outcome.');
  if (typeof evidence !== 'string' || evidence.trim().length < 10 || evidence.length > 2000)
    throw new Error(
      'Record provider evidence (10–2000 characters); absence from the inbox is not evidence of non-acceptance.'
    );
  const pid = typeof providerId === 'string' ? providerId.trim() : '';
  if (outcome === 'accepted' && (!pid || pid.length > 998 || /[\r\n\s]/.test(pid) || !normId(pid)))
    throw new Error('Acceptance requires the provider Message-ID.');
  await finish(
    db,
    draft,
    outcome,
    outcome === 'accepted' ? pid : null,
    outcome === 'failed' ? 'operator_confirmed_non_acceptance' : null,
    evidence.trim()
  );
}
