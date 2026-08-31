import type { Env } from '../../types';
import { nextActionCreatedEvent } from './opportunities';

type DB = Env['DB'];
const ACTOR = 'owner';
const iso = (date: Date) => date.toISOString();
const cleanText = (value: unknown, label: string, max = 500) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  if (value.trim().length > max) throw new Error(`${label} is too long.`);
  return value.trim();
};
export function parseDue(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw new Error('Due date must be a valid UTC date and time.');
  const date = new Date(`${value}:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 16) !== value)
    throw new Error('Due date must be a valid UTC date and time.');
  return date.toISOString();
}
async function sourceContact(db: DB, type: string, id: string) {
  if (type === 'contact')
    return (await db.prepare('SELECT id FROM contacts WHERE id=?').bind(id).first<{ id: string }>())?.id;
  if (type === 'conversation')
    return (await db.prepare('SELECT contact_id id FROM conversations WHERE id=?').bind(id).first<{ id: string }>())
      ?.id;
  return undefined;
}
export async function createNextAction(
  db: DB,
  input: {
    description: unknown;
    due: unknown;
    sourceType: string;
    sourceId: string;
  },
  now = new Date()
) {
  const description = cleanText(input.description, 'Description');
  const dueAt = parseDue(input.due);
  const contactId = await sourceContact(db, input.sourceType, input.sourceId);
  if (!contactId) throw new Error('Source record not found.');
  const id = `action:${crypto.randomUUID()}`,
    at = iso(now);
  await db.batch([
    db
      .prepare(
        'INSERT INTO next_actions(id,description,due_at,source_type,source_id,contact_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)'
      )
      .bind(id, description, dueAt, input.sourceType, input.sourceId, contactId, ACTOR, at),
    db
      .prepare(
        'INSERT INTO activity_events(id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,source_type,source_id,new_state_json) VALUES(?,?,?,?,?,?,?,?,?,?)'
      )
      .bind(
        `event:${crypto.randomUUID()}`,
        'next_action.created',
        ACTOR,
        at,
        'next_action',
        id,
        contactId,
        input.sourceType,
        input.sourceId,
        JSON.stringify({ status: 'open', description, due_at: dueAt })
      )
  ]);
  return id;
}
type ActionRow = {
  id: string;
  status: string;
  description: string;
  due_at: string | null;
  contact_id: string;
  source_type: string;
  source_id: string;
  opportunity_id: string | null;
  is_designated: number;
};
type ActionCommand = 'complete' | 'cancel' | 'reopen' | 'reschedule';
const actionCommands = new Set<ActionCommand>(['complete', 'cancel', 'reopen', 'reschedule']);

export async function transitionNextAction(
  db: DB,
  id: string,
  command: unknown,
  input: { reason?: unknown; due?: unknown; replacement?: unknown; exit?: unknown; outcomeReason?: unknown } = {},
  now = new Date()
) {
  if (typeof command !== 'string' || !actionCommands.has(command as ActionCommand)) {
    throw new Error('Unknown next action command.');
  }
  const row = await db
    .prepare(
      'SELECT id,status,description,due_at,contact_id,source_type,source_id,opportunity_id,is_designated FROM next_actions WHERE id=?'
    )
    .bind(id)
    .first<ActionRow>();
  if (!row) throw new Error('Next action not found.');
  const allowed = command === 'reopen' ? row.status !== 'open' : row.status === 'open';
  if (!allowed) throw new Error(`Cannot ${command} an action that is ${row.status}.`);
  const validCommand = command as ActionCommand;
  const at = iso(now);
  let status = row.status,
    due = row.due_at,
    reason: string | null = null;
  if (command === 'complete') status = 'completed';
  if (command === 'cancel') {
    status = 'cancelled';
    reason = cleanText(input.reason, 'Cancellation reason');
  }
  if (command === 'reopen') {
    status = 'open';
    reason = cleanText(input.reason, 'Reopen reason');
  }
  if (command === 'reschedule') due = parseDue(input.due);
  const prior = { status: row.status, due_at: row.due_at };
  const next = { status, due_at: due };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE next_actions SET status=?,due_at=?,completed_at=?,completion_source=?,cancelled_at=?,cancel_reason=? WHERE id=?`
      )
      .bind(
        status,
        due,
        status === 'completed' ? at : null,
        status === 'completed' ? 'manual' : null,
        status === 'cancelled' ? at : null,
        status === 'cancelled' ? reason : null,
        id
      ),
    db
      .prepare(
        'INSERT INTO activity_events(id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,source_type,source_id,prior_state_json,new_state_json,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
      )
      .bind(
        `event:${crypto.randomUUID()}`,
        `next_action.${validCommand === 'complete' ? 'completed' : validCommand === 'cancel' ? 'cancelled' : validCommand === 'reopen' ? 'reopened' : 'rescheduled'}`,
        ACTOR,
        at,
        'next_action',
        id,
        row.contact_id,
        row.source_type,
        row.source_id,
        JSON.stringify(prior),
        JSON.stringify(next),
        reason
      )
  ];
  let guardOpportunity = false;
  if (row.opportunity_id && row.is_designated && (command === 'complete' || command === 'cancel')) {
    const opportunity = await db
      .prepare('SELECT state FROM opportunities WHERE id=?')
      .bind(row.opportunity_id)
      .first<{ state: string }>();
    if (opportunity?.state === 'active') {
      guardOpportunity = true;
      if (input.replacement) {
        const replacement = cleanText(input.replacement, 'Replacement next action');
        const replacementId = `action:${crypto.randomUUID()}`;
        statements.unshift(db.prepare('UPDATE next_actions SET is_designated=0 WHERE id=?').bind(id));
        statements.push(
          db
            .prepare(
              `INSERT INTO next_actions
             (id,description,status,source_type,source_id,contact_id,created_by,
              created_at,opportunity_id,is_designated)
             VALUES(?,?,'open','contact',?,?,'owner',?,?,1)`
            )
            .bind(replacementId, replacement, row.contact_id, row.contact_id, at, row.opportunity_id),
          nextActionCreatedEvent(db, replacementId, row.opportunity_id, row.contact_id, replacement, at)
        );
      } else if (input.exit === 'won' || input.exit === 'lost') {
        const outcomeReason = cleanText(input.outcomeReason, 'Outcome reason');
        statements.unshift(db.prepare('UPDATE next_actions SET is_designated=0 WHERE id=?').bind(id));
        statements.push(
          db
            .prepare(
              `UPDATE opportunities SET state=?,outcome_reason=?,outcome_at=?,updated_at=?
             WHERE id=? AND state='active'`
            )
            .bind(input.exit, outcomeReason, at, at, row.opportunity_id),
          db
            .prepare(
              `INSERT INTO activity_events
             (id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,
              source_type,source_id,prior_state_json,new_state_json,reason)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
            )
            .bind(
              `event:${crypto.randomUUID()}`,
              `opportunity.${input.exit}`,
              ACTOR,
              at,
              'opportunity',
              row.opportunity_id,
              row.contact_id,
              'opportunity',
              row.opportunity_id,
              JSON.stringify({ state: 'active' }),
              JSON.stringify({ state: input.exit }),
              outcomeReason
            )
        );
      } else {
        throw new Error('A designated action requires a replacement or a won/lost outcome.');
      }
    }
  }
  // Canaries: each asserts the state this command read; on a concurrent change the
  // INSERT hits the existing primary key and D1 rolls back the whole batch.
  statements.unshift(
    db
      .prepare(
        'INSERT INTO next_actions(id,description,status,source_type,source_id,contact_id,created_by,created_at) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM next_actions WHERE id=? AND status=?)'
      )
      .bind(id, '', '', '', '', '', '', '', id, row.status)
  );
  if (guardOpportunity)
    statements.unshift(
      db
        .prepare(
          'INSERT INTO opportunities(id,title,desired_outcome,contact_id,product_id,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM opportunities WHERE id=? AND state=?)'
        )
        .bind(row.opportunity_id, '', '', '', '', '', '', row.opportunity_id, 'active')
    );
  try {
    await db.batch(statements);
  } catch (error) {
    const current = await db.prepare('SELECT status FROM next_actions WHERE id=?').bind(id).first<{ status: string }>();
    if (current?.status !== row.status) {
      throw new Error('Next action changed while the command was being applied.', { cause: error });
    }
    if (guardOpportunity) {
      const opportunity = await db
        .prepare('SELECT state FROM opportunities WHERE id=?')
        .bind(row.opportunity_id)
        .first<{ state: string }>();
      if (opportunity?.state !== 'active') {
        throw new Error('Opportunity changed while the command was being applied.', { cause: error });
      }
    }
    throw error;
  }
}
export async function listToday(db: DB, now = new Date()) {
  const today = iso(now).slice(0, 10),
    boundary = `${today}T23:59:59.999Z`;
  const actions = await db
    .prepare(
      `SELECT na.*,ct.display_name,ce.address contact_email,c.subject,
        coalesce(p.name,op.name) product,coalesce(d.name,od.name) domain,
        coalesce(mi.address,(SELECT omi.address FROM opportunity_conversations oc
          JOIN mailbox_identities omi ON omi.id=oc.mailbox_identity_id
          WHERE oc.opportunity_id=o.id ORDER BY oc.created_at,oc.conversation_id LIMIT 1)) mailbox,
        o.title opportunity_title
       FROM next_actions na
       JOIN contacts ct ON ct.id=na.contact_id
       JOIN contact_email_addresses ce ON ce.id=ct.primary_email_id
       LEFT JOIN conversations c ON na.source_type='conversation' AND c.id=na.source_id
       LEFT JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id
       LEFT JOIN products p ON p.id=mi.product_id LEFT JOIN domains d ON d.id=p.domain_id
       LEFT JOIN opportunities o ON o.id=na.opportunity_id
       LEFT JOIN products op ON op.id=o.product_id LEFT JOIN domains od ON od.id=op.domain_id
       WHERE na.status='open' AND (na.due_at IS NULL OR na.due_at<=? OR (na.opportunity_id IS NOT NULL AND na.is_designated=1))
       ORDER BY na.due_at,na.id`
    )
    .bind(boundary)
    .all<Record<string, unknown>>();
  const inbound = await db
    .prepare(
      `SELECT c.id,c.subject,c.updated_at,ct.display_name,ce.address contact_email,mi.address mailbox,p.name product,d.name domain FROM conversations c JOIN contacts ct ON ct.id=c.contact_id JOIN contact_email_addresses ce ON ce.id=ct.primary_email_id JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id WHERE c.needs_attention=1 ORDER BY c.updated_at,c.id`
    )
    .all<Record<string, unknown>>();
  return {
    overdue: actions.results.filter((x) => x.due_at && String(x.due_at).slice(0, 10) < today),
    due: actions.results.filter((x) => !x.due_at || String(x.due_at).slice(0, 10) === today),
    inbound: inbound.results,
    today
  };
}
