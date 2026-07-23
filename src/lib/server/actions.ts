import type { Env } from "../../types";

type DB = Env["DB"];
const ACTOR = "owner";
const iso = (date: Date) => date.toISOString();
const cleanText = (value: unknown, label: string, max = 500) => {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} is required.`);
  if (value.trim().length > max) throw new Error(`${label} is too long.`);
  return value.trim();
};
export function parseDue(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw new Error("Due date must be a valid UTC date and time.");
  const date = new Date(`${value}:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 16) !== value)
    throw new Error("Due date must be a valid UTC date and time.");
  return date.toISOString();
}
async function sourceContact(db: DB, type: string, id: string) {
  if (type === "contact")
    return (
      await db
        .prepare("SELECT id FROM contacts WHERE id=?")
        .bind(id)
        .first<{ id: string }>()
    )?.id;
  if (type === "conversation")
    return (
      await db
        .prepare("SELECT contact_id id FROM conversations WHERE id=?")
        .bind(id)
        .first<{ id: string }>()
    )?.id;
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
  now = new Date(),
) {
  const description = cleanText(input.description, "Description");
  const dueAt = parseDue(input.due);
  const contactId = await sourceContact(db, input.sourceType, input.sourceId);
  if (!contactId) throw new Error("Source record not found.");
  const id = `action:${crypto.randomUUID()}`,
    at = iso(now);
  await db.batch([
    db
      .prepare(
        "INSERT INTO next_actions(id,description,due_at,source_type,source_id,contact_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        description,
        dueAt,
        input.sourceType,
        input.sourceId,
        contactId,
        ACTOR,
        at,
      ),
    db
      .prepare(
        "INSERT INTO activity_events(id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,source_type,source_id,new_state_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        `event:${crypto.randomUUID()}`,
        "next_action.created",
        ACTOR,
        at,
        "next_action",
        id,
        contactId,
        input.sourceType,
        input.sourceId,
        JSON.stringify({ status: "open", description, due_at: dueAt }),
      ),
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
};
type ActionCommand = "complete" | "cancel" | "reopen" | "reschedule";
const actionCommands = new Set<ActionCommand>([
  "complete",
  "cancel",
  "reopen",
  "reschedule",
]);

export async function transitionNextAction(
  db: DB,
  id: string,
  command: unknown,
  input: { reason?: unknown; due?: unknown } = {},
  now = new Date(),
) {
  if (
    typeof command !== "string" ||
    !actionCommands.has(command as ActionCommand)
  ) {
    throw new Error("Unknown next action command.");
  }
  const row = await db
    .prepare(
      "SELECT id,status,description,due_at,contact_id,source_type,source_id FROM next_actions WHERE id=?",
    )
    .bind(id)
    .first<ActionRow>();
  if (!row) throw new Error("Next action not found.");
  const allowed =
    command === "reopen" ? row.status !== "open" : row.status === "open";
  if (!allowed)
    throw new Error(`Cannot ${command} an action that is ${row.status}.`);
  const validCommand = command as ActionCommand;
  const at = iso(now);
  let status = row.status,
    due = row.due_at,
    reason: string | null = null;
  if (command === "complete") status = "completed";
  if (command === "cancel") {
    status = "cancelled";
    reason = cleanText(input.reason, "Cancellation reason");
  }
  if (command === "reopen") {
    status = "open";
    reason = cleanText(input.reason, "Reopen reason");
  }
  if (command === "reschedule") due = parseDue(input.due);
  const prior = { status: row.status, due_at: row.due_at };
  const next = { status, due_at: due };
  await db.batch([
    db
      .prepare(
        `UPDATE next_actions SET status=?,due_at=?,completed_at=?,completion_source=?,cancelled_at=?,cancel_reason=? WHERE id=?`,
      )
      .bind(
        status,
        due,
        status === "completed" ? at : null,
        status === "completed" ? "manual" : null,
        status === "cancelled" ? at : null,
        status === "cancelled" ? reason : null,
        id,
      ),
    db
      .prepare(
        "INSERT INTO activity_events(id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,source_type,source_id,prior_state_json,new_state_json,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        `event:${crypto.randomUUID()}`,
        `next_action.${validCommand === "complete" ? "completed" : validCommand === "cancel" ? "cancelled" : validCommand === "reopen" ? "reopened" : "rescheduled"}`,
        ACTOR,
        at,
        "next_action",
        id,
        row.contact_id,
        row.source_type,
        row.source_id,
        JSON.stringify(prior),
        JSON.stringify(next),
        reason,
      ),
  ]);
}
export async function listToday(db: DB, now = new Date()) {
  const today = iso(now).slice(0, 10),
    boundary = `${today}T23:59:59.999Z`;
  const actions = await db
    .prepare(
      `SELECT na.*,ct.display_name,ce.address contact_email,c.subject,mi.address mailbox,p.name product,d.name domain FROM next_actions na JOIN contacts ct ON ct.id=na.contact_id JOIN contact_email_addresses ce ON ce.id=ct.primary_email_id LEFT JOIN conversations c ON na.source_type='conversation' AND c.id=na.source_id LEFT JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id LEFT JOIN products p ON p.id=mi.product_id LEFT JOIN domains d ON d.id=p.domain_id WHERE na.status='open' AND na.due_at<=? ORDER BY na.due_at,na.id`,
    )
    .bind(boundary)
    .all<Record<string, unknown>>();
  const inbound = await db
    .prepare(
      `SELECT c.id,c.subject,c.updated_at,ct.display_name,ce.address contact_email,mi.address mailbox,p.name product,d.name domain FROM conversations c JOIN contacts ct ON ct.id=c.contact_id JOIN contact_email_addresses ce ON ce.id=ct.primary_email_id JOIN mailbox_identities mi ON mi.id=c.mailbox_identity_id JOIN products p ON p.id=mi.product_id JOIN domains d ON d.id=p.domain_id WHERE c.needs_attention=1 ORDER BY c.updated_at,c.id`,
    )
    .all<Record<string, unknown>>();
  return {
    overdue: actions.results.filter(
      (x) => String(x.due_at).slice(0, 10) < today,
    ),
    due: actions.results.filter((x) => String(x.due_at).slice(0, 10) === today),
    inbound: inbound.results,
    today,
  };
}
