import type { Env } from '../../types';

type DB = Env['DB'];
export type OpportunityState = 'new' | 'qualified' | 'active' | 'won' | 'lost' | 'archived';

const requiredText = (value: unknown, label: string, max = 500) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  if (value.trim().length > max) throw new Error(`${label} is too long.`);
  return value.trim();
};

const requireOwner = (actor: unknown) => {
  if (actor !== 'owner') {
    throw new Error('Only the personal owner can change opportunity lifecycle.');
  }
  return 'owner';
};

function opportunityEvent(
  db: DB,
  opportunityId: string,
  type: string,
  at: string,
  contactId: string,
  prior: object | null,
  next: object,
  reason: string | null = null
) {
  return db
    .prepare(
      `INSERT INTO activity_events
       (id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,
        source_type,source_id,prior_state_json,new_state_json,reason)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      `event:${crypto.randomUUID()}`,
      type,
      'owner',
      at,
      'opportunity',
      opportunityId,
      contactId,
      'opportunity',
      opportunityId,
      prior && JSON.stringify(prior),
      JSON.stringify(next),
      reason
    );
}

export function nextActionCreatedEvent(
  db: DB,
  actionId: string,
  opportunityId: string,
  contactId: string,
  description: string,
  at: string
) {
  return db
    .prepare(
      `INSERT INTO activity_events
       (id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,
        source_type,source_id,new_state_json)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      `event:${crypto.randomUUID()}`,
      'next_action.created',
      'owner',
      at,
      'next_action',
      actionId,
      contactId,
      'opportunity',
      opportunityId,
      JSON.stringify({
        status: 'open',
        description,
        opportunity_id: opportunityId,
        is_designated: true
      })
    );
}

export async function createOpportunity(db: DB, input: Record<string, unknown>, now = new Date()) {
  const title = requiredText(input.title, 'Title', 200);
  const desiredOutcome = requiredText(input.desiredOutcome, 'Desired outcome');
  const conversationId = requiredText(input.conversationId, 'Evidence conversation', 200);
  const evidence = await db
    .prepare(
      `SELECT c.contact_id,mi.product_id,mi.id mailbox_identity_id,p.domain_id
       FROM conversations c
       JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id
       JOIN products p ON p.id=mi.product_id
       WHERE c.id=?`
    )
    .bind(conversationId)
    .first<Record<string, string>>();
  if (!evidence) throw new Error('Evidence conversation not found.');
  if (input.contactId && input.contactId !== evidence.contact_id) {
    throw new Error('Evidence contact does not match the opportunity contact.');
  }
  if (input.productId && input.productId !== evidence.product_id) {
    throw new Error('Evidence product does not match the opportunity product.');
  }

  let valueMinor: number | null = null;
  let currency: string | null = null;
  const hasValue = input.valueMinor !== undefined && input.valueMinor !== null && input.valueMinor !== '';
  if (hasValue) {
    valueMinor = typeof input.valueMinor === 'number' ? input.valueMinor : Number(input.valueMinor);
    currency = typeof input.currency === 'string' ? input.currency.trim() : null;
    if (!Number.isSafeInteger(valueMinor) || valueMinor < 0) {
      throw new Error('Value must be a non-negative integer in minor units.');
    }
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error('Currency must be a three-letter uppercase code.');
    }
  } else if (input.currency) {
    throw new Error('Currency requires a value.');
  }

  const id = `opportunity:${crypto.randomUUID()}`;
  const at = now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO opportunities
       (id,title,desired_outcome,contact_id,product_id,value_minor,currency,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
      )
      .bind(id, title, desiredOutcome, evidence.contact_id, evidence.product_id, valueMinor, currency, at, at),
    db.prepare('INSERT INTO opportunity_contacts VALUES(?,?,?)').bind(id, evidence.contact_id, at),
    db
      .prepare('INSERT INTO opportunity_conversations VALUES(?,?,?,?,?,?)')
      .bind(id, conversationId, evidence.product_id, evidence.mailbox_identity_id, evidence.domain_id, at),
    opportunityEvent(db, id, 'opportunity.created', at, evidence.contact_id, null, {
      state: 'new',
      desired_outcome: desiredOutcome
    })
  ]);
  return id;
}

const transitions: Record<string, OpportunityState[]> = {
  qualify: ['new'],
  activate: ['qualified'],
  win: ['active'],
  lose: ['active'],
  archive: ['won', 'lost'],
  reopen: ['won', 'lost']
};

export async function transitionOpportunity(
  db: DB,
  id: string,
  command: unknown,
  input: Record<string, unknown> = {},
  actor: unknown = 'owner',
  now = new Date()
) {
  requireOwner(actor);
  if (typeof command !== 'string' || !(command in transitions)) {
    throw new Error('Unknown opportunity command.');
  }
  const row = await db.prepare('SELECT * FROM opportunities WHERE id=?').bind(id).first<Record<string, any>>();
  if (!row) throw new Error('Opportunity not found.');
  if (!transitions[command].includes(row.state)) {
    throw new Error(`Cannot ${command} an opportunity that is ${row.state}.`);
  }

  const target: OpportunityState =
    command === 'qualify'
      ? 'qualified'
      : command === 'activate' || command === 'reopen'
        ? 'active'
        : command === 'win'
          ? 'won'
          : command === 'lose'
            ? 'lost'
            : 'archived';
  const at = now.toISOString();
  // Canary: when the opportunity is no longer in the state this command read, the
  // SELECT produces the existing primary key, the INSERT fails, and D1 rolls back
  // the whole batch, so a concurrent change never commits a partial transition.
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        'INSERT INTO opportunities(id,title,desired_outcome,contact_id,product_id,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM opportunities WHERE id=? AND state=?)'
      )
      .bind(id, '', '', '', '', '', '', id, row.state)
  ];
  let reason: string | null = null;
  if (target === 'won' || target === 'lost') {
    reason = requiredText(input.reason, 'Outcome reason');
  }
  if (target === 'active') {
    const description = requiredText(input.nextAction, 'Next action');
    const actionId = `action:${crypto.randomUUID()}`;
    statements.push(
      db
        .prepare(
          `INSERT INTO next_actions
         (id,description,due_at,status,source_type,source_id,contact_id,created_by,
          created_at,opportunity_id,is_designated)
         VALUES(?,?,NULL,'open','contact',?,?,'owner',?,?,1)`
        )
        .bind(actionId, description, row.contact_id, row.contact_id, at, id),
      nextActionCreatedEvent(db, actionId, id, row.contact_id, description, at)
    );
  } else if (row.state === 'active') {
    const designatedAction = await db
      .prepare(
        `SELECT id,description,due_at FROM next_actions
         WHERE opportunity_id=? AND status='open' AND is_designated=1`
      )
      .bind(id)
      .first<{ id: string; description: string; due_at: string | null }>();
    if (!designatedAction) {
      throw new Error('Active opportunity has no designated next action.');
    }
    const actionReason = `Opportunity marked ${target}: ${reason}`;
    statements.push(
      db
        .prepare(
          `UPDATE next_actions SET status='cancelled',is_designated=0,cancelled_at=?,cancel_reason=?
         WHERE id=? AND status='open' AND is_designated=1`
        )
        .bind(at, actionReason, designatedAction.id),
      db
        .prepare(
          `INSERT INTO activity_events
         (id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,
          source_type,source_id,prior_state_json,new_state_json,reason)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(
          `event:${crypto.randomUUID()}`,
          'next_action.cancelled',
          'owner',
          at,
          'next_action',
          designatedAction.id,
          row.contact_id,
          'opportunity',
          id,
          JSON.stringify({
            status: 'open',
            due_at: designatedAction.due_at,
            is_designated: true
          }),
          JSON.stringify({
            status: 'cancelled',
            due_at: designatedAction.due_at,
            is_designated: false
          }),
          actionReason
        )
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE opportunities SET state=?,outcome_reason=?,outcome_at=?,updated_at=?
       WHERE id=? AND state=?`
      )
      .bind(
        target,
        target === 'archived' ? row.outcome_reason : reason,
        target === 'archived' ? row.outcome_at : target === 'won' || target === 'lost' ? at : null,
        at,
        id,
        row.state
      ),
    opportunityEvent(
      db,
      id,
      `opportunity.${command === 'win' ? 'won' : command === 'lose' ? 'lost' : command === 'qualify' ? 'qualified' : command === 'activate' ? 'activated' : command === 'reopen' ? 'reopened' : 'archived'}`,
      at,
      row.contact_id,
      { state: row.state },
      { state: target },
      reason
    )
  );
  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch (error) {
    const current = await db.prepare('SELECT state FROM opportunities WHERE id=?').bind(id).first<{ state: string }>();
    if (current?.state !== row.state) {
      throw new Error('Opportunity changed while the command was being applied.', { cause: error });
    }
    throw error;
  }
  const updateResult = results.at(-2);
  if (updateResult?.meta.changes !== 1) {
    throw new Error('Opportunity changed while the command was being applied.');
  }
}

const opportunityQuery = (where: string) =>
  `SELECT o.*,ct.display_name,ce.address contact_email,p.name product,d.name domain,
      na.description next_action
     FROM opportunities o
     JOIN contacts ct ON ct.id=o.contact_id
     LEFT JOIN contact_email_addresses ce ON ce.id=ct.primary_email_id
     JOIN products p ON p.id=o.product_id JOIN domains d ON d.id=p.domain_id
     LEFT JOIN next_actions na ON na.opportunity_id=o.id AND na.status='open' AND na.is_designated=1
     ${where}
     ORDER BY o.updated_at DESC,o.id`;

export async function listOpportunities(db: DB, state?: string) {
  const valid = ['new', 'qualified', 'active', 'won', 'lost', 'archived'];
  if (state && !valid.includes(state)) throw new Error('Invalid opportunity filter.');
  const rows = await db
    .prepare(opportunityQuery(state ? 'WHERE o.state=?' : ''))
    .bind(...(state ? [state] : []))
    .all();
  return rows.results;
}

export async function getOpportunity(db: DB, id: string) {
  const opportunity = await db.prepare(opportunityQuery('WHERE o.id=?')).bind(id).first();
  if (!opportunity) return null;
  const [evidence, history] = await Promise.all([
    db
      .prepare(
        `SELECT oc.*,c.subject,p.name product,d.name domain,mi.address mailbox
       FROM opportunity_conversations oc
       JOIN conversations c ON c.id=oc.conversation_id
       JOIN products p ON p.id=oc.product_id
       JOIN domains d ON d.id=oc.domain_id
       JOIN mailbox_identities mi ON mi.id=oc.mailbox_identity_id
       WHERE oc.opportunity_id=? ORDER BY oc.created_at`
      )
      .bind(id)
      .all(),
    db
      .prepare(
        "SELECT * FROM activity_events WHERE subject_type='opportunity' AND subject_id=? ORDER BY occurred_at DESC,id DESC"
      )
      .bind(id)
      .all()
  ]);
  return { opportunity, evidence: evidence.results, history: history.results };
}
