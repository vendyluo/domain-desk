import type { Env } from '../../types';

type DB = Env['DB'];
const ACTOR = 'owner';

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${label} is too long.`);
  return text;
}

export async function listContacts(db: DB, q = '') {
  const term = q.trim();
  const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await db
    .prepare(
      `
    SELECT ct.id, ct.display_name, ce.address primary_email,
      max(m.received_at) last_activity, count(DISTINCT p.id) products,
      (SELECT count(*) FROM next_actions na WHERE na.contact_id=ct.id AND na.status='open') open_actions
    FROM contacts ct
    JOIN contact_email_addresses ce ON ce.id=ct.primary_email_id
    LEFT JOIN messages m ON m.contact_id=ct.id
    LEFT JOIN mailbox_identities mi ON mi.id=m.mailbox_identity_id
    LEFT JOIN products p ON p.id=mi.product_id
    WHERE ct.merged_into_id IS NULL AND
      (?='' OR ct.display_name LIKE ? ESCAPE '\\' OR EXISTS(
        SELECT 1 FROM contact_email_addresses x
        WHERE x.contact_id=ct.id AND x.address LIKE ? ESCAPE '\\'
      ))
    GROUP BY ct.id ORDER BY last_activity DESC, ct.id
  `
    )
    .bind(term, like, like)
    .all<Record<string, unknown>>();
  return rows.results;
}

export async function getContact(db: DB, id: string) {
  const contact = await db
    .prepare(
      `
    SELECT ct.*, ce.address primary_email
    FROM contacts ct LEFT JOIN contact_email_addresses ce ON ce.id=ct.primary_email_id
    WHERE ct.id=?
  `
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!contact) return null;
  if (contact.merged_into_id) return { aliasOf: String(contact.merged_into_id) };

  const addresses = await db
    .prepare(
      `
    SELECT *, id=? is_primary FROM contact_email_addresses
    WHERE contact_id=? ORDER BY is_primary DESC, created_at, id
  `
    )
    .bind(contact.primary_email_id, id)
    .all();
  const messages = await db
    .prepare(
      `
    SELECT m.id,m.conversation_id,m.subject,m.sender_name,m.sender_address,m.text_body,m.received_at,
      mi.address mailbox,p.name product,d.name domain
    FROM messages m JOIN mailbox_identities mi ON mi.id=m.mailbox_identity_id
    JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id
    WHERE m.contact_id=? ORDER BY m.received_at DESC,m.id DESC
  `
    )
    .bind(id)
    .all();
  const actions = await db
    .prepare('SELECT * FROM next_actions WHERE contact_id=? ORDER BY created_at DESC,id')
    .bind(id)
    .all();
  const events = await db
    .prepare('SELECT * FROM activity_events WHERE contact_id=? ORDER BY occurred_at DESC,id DESC')
    .bind(id)
    .all();
  const conversations = await db
    .prepare(
      `SELECT c.id,c.subject,p.name product,d.name domain,mi.address mailbox
       FROM conversations c JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id
       JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id
       WHERE c.contact_id=? ORDER BY c.updated_at DESC,c.id`
    )
    .bind(id)
    .all();
  return {
    contact,
    addresses: addresses.results,
    messages: messages.results,
    actions: actions.results,
    events: events.results,
    conversations: conversations.results
  };
}

export async function updateDisplayName(db: DB, contactId: string, value: unknown, now = new Date()) {
  const displayName = requiredText(value, 'Display name', 200);
  const contact = await db
    .prepare('SELECT display_name,merged_into_id FROM contacts WHERE id=?')
    .bind(contactId)
    .first<{ display_name: string | null; merged_into_id: string | null }>();
  if (!contact || contact.merged_into_id) throw new Error('Contact not found.');
  if (contact.display_name === displayName) return;
  const at = now.toISOString();
  await db.batch([
    db.prepare('UPDATE contacts SET display_name=? WHERE id=?').bind(displayName, contactId),
    db
      .prepare(
        `INSERT INTO activity_events
      (id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,prior_state_json,new_state_json)
      VALUES(?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        `event:${crypto.randomUUID()}`,
        'contact.display_name_changed',
        ACTOR,
        at,
        'contact',
        contactId,
        contactId,
        JSON.stringify({ display_name: contact.display_name }),
        JSON.stringify({ display_name: displayName })
      )
  ]);
}

export async function choosePrimaryEmail(db: DB, contactId: string, emailId: unknown, now = new Date()) {
  const id = requiredText(emailId, 'Primary email', 300);
  const contact = await db
    .prepare('SELECT primary_email_id,merged_into_id FROM contacts WHERE id=?')
    .bind(contactId)
    .first<{
      primary_email_id: string | null;
      merged_into_id: string | null;
    }>();
  if (!contact || contact.merged_into_id) throw new Error('Contact not found.');
  const owned = await db
    .prepare('SELECT id,address FROM contact_email_addresses WHERE id=? AND contact_id=?')
    .bind(id, contactId)
    .first<{ id: string; address: string }>();
  if (!owned) throw new Error('Primary email must belong to this contact.');
  if (contact.primary_email_id === id) return;
  const at = now.toISOString();
  await db.batch([
    db.prepare('UPDATE contacts SET primary_email_id=? WHERE id=?').bind(id, contactId),
    db
      .prepare(
        `INSERT INTO activity_events
      (id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,prior_state_json,new_state_json)
      VALUES(?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        `event:${crypto.randomUUID()}`,
        'contact.primary_email_changed',
        ACTOR,
        at,
        'contact',
        contactId,
        contactId,
        JSON.stringify({ primary_email_id: contact.primary_email_id }),
        JSON.stringify({ primary_email_id: id, address: owned.address })
      )
  ]);
}

export async function previewContactMerge(db: DB, survivorId: string, duplicateId: string) {
  if (!duplicateId || survivorId === duplicateId) throw new Error('Choose a different duplicate contact.');
  const contacts = await db
    .prepare(
      `
    SELECT ct.id,ct.display_name,ct.merged_into_id,ce.address primary_email
    FROM contacts ct LEFT JOIN contact_email_addresses ce ON ce.id=ct.primary_email_id
    WHERE ct.id IN (?,?)
  `
    )
    .bind(survivorId, duplicateId)
    .all<Record<string, unknown>>();
  if (contacts.results.length !== 2 || contacts.results.some((row) => row.merged_into_id)) {
    throw new Error('Both contacts must exist and be active.');
  }
  const survivor = contacts.results.find((row) => row.id === survivorId)!;
  const duplicate = contacts.results.find((row) => row.id === duplicateId)!;
  const addresses = await db
    .prepare('SELECT id,address FROM contact_email_addresses WHERE contact_id=? ORDER BY created_at,id')
    .bind(duplicateId)
    .all();
  const counts = await db
    .prepare(
      `SELECT
    (SELECT count(*) FROM conversations WHERE contact_id=?) conversations,
    (SELECT count(*) FROM messages WHERE contact_id=?) messages,
    (SELECT count(*) FROM next_actions WHERE contact_id=?) next_actions,
    (SELECT count(*) FROM activity_events WHERE contact_id=?) activity_events,
    (SELECT count(*) FROM opportunities WHERE contact_id=?) opportunities
  `
    )
    .bind(duplicateId, duplicateId, duplicateId, duplicateId, duplicateId)
    .first<Record<string, number>>();
  return { survivor, duplicate, addresses: addresses.results, counts: counts! };
}

export async function mergeContacts(
  db: DB,
  survivorId: string,
  duplicateId: string,
  confirmation: unknown,
  now = new Date()
) {
  if (confirmation !== duplicateId) throw new Error('Merge confirmation did not match the duplicate contact.');
  const preview = await previewContactMerge(db, survivorId, duplicateId);
  const relationIds: Record<string, unknown[]> = {};
  for (const [key, table] of [
    ['addresses', 'contact_email_addresses'],
    ['conversations', 'conversations'],
    ['messages', 'messages'],
    ['next_actions', 'next_actions'],
    ['activity_events', 'activity_events'],
    ['opportunities', 'opportunities']
  ] as const) {
    relationIds[key] = (
      await db.prepare(`SELECT id FROM ${table} WHERE contact_id=? ORDER BY id`).bind(duplicateId).all<{ id: string }>()
    ).results.map((row) => row.id);
  }
  relationIds.opportunity_contacts = (
    await db
      .prepare('SELECT opportunity_id FROM opportunity_contacts WHERE contact_id=? ORDER BY opportunity_id')
      .bind(duplicateId)
      .all<{ opportunity_id: string }>()
  ).results.map((row) => row.opportunity_id);
  const at = now.toISOString();
  const mergeId = `merge:${crypto.randomUUID()}`;
  const prior = {
    survivor: preview.survivor,
    duplicate: preview.duplicate,
    relations: relationIds
  };
  const next = {
    duplicate_merged_into_id: survivorId,
    moved_counts: preview.counts
  };
  await db.batch([
    db.prepare('UPDATE contact_email_addresses SET contact_id=? WHERE contact_id=?').bind(survivorId, duplicateId),
    db.prepare('UPDATE conversations SET contact_id=? WHERE contact_id=?').bind(survivorId, duplicateId),
    db.prepare('UPDATE messages SET contact_id=? WHERE contact_id=?').bind(survivorId, duplicateId),
    db.prepare('UPDATE next_actions SET contact_id=? WHERE contact_id=?').bind(survivorId, duplicateId),
    db.prepare('UPDATE activity_events SET contact_id=? WHERE contact_id=?').bind(survivorId, duplicateId),
    db.prepare('UPDATE opportunities SET contact_id=? WHERE contact_id=?').bind(survivorId, duplicateId),
    db
      .prepare(
        'INSERT OR IGNORE INTO opportunity_contacts(opportunity_id,contact_id,created_at) SELECT opportunity_id,?,created_at FROM opportunity_contacts WHERE contact_id=?'
      )
      .bind(survivorId, duplicateId),
    db.prepare('DELETE FROM opportunity_contacts WHERE contact_id=?').bind(duplicateId),
    db
      .prepare('UPDATE contacts SET merged_into_id=? WHERE id=? AND merged_into_id IS NULL')
      .bind(survivorId, duplicateId),
    db
      .prepare(
        `INSERT INTO contact_merges
      (id,survivor_id,duplicate_id,actor,merged_at,prior_state_json,new_state_json,provenance_json)
      VALUES(?,?,?,?,?,?,?,?)`
      )
      .bind(
        mergeId,
        survivorId,
        duplicateId,
        ACTOR,
        at,
        JSON.stringify(prior),
        JSON.stringify(next),
        JSON.stringify({
          command: 'explicit_contact_merge',
          confirmation: duplicateId
        })
      ),
    db
      .prepare(
        `INSERT INTO activity_events
      (id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,source_type,source_id,prior_state_json,new_state_json,reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        `event:${crypto.randomUUID()}`,
        'contact.merged',
        ACTOR,
        at,
        'contact',
        survivorId,
        survivorId,
        'contact',
        duplicateId,
        JSON.stringify(prior),
        JSON.stringify(next),
        `Explicit merge ${mergeId}`
      )
  ]);
  return mergeId;
}
