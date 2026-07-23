PRAGMA foreign_keys = ON;

CREATE TABLE next_actions (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')),
  source_type TEXT NOT NULL CHECK(source_type IN ('contact','conversation')),
  source_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  completion_source TEXT CHECK(completion_source IS NULL OR completion_source='manual'),
  cancelled_at TEXT,
  cancel_reason TEXT
);
CREATE INDEX next_actions_queue ON next_actions(status,due_at);
CREATE INDEX next_actions_contact ON next_actions(contact_id,status);

CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('next_action','conversation','contact')),
  subject_id TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id),
  source_type TEXT,
  source_id TEXT,
  prior_state_json TEXT,
  new_state_json TEXT,
  reason TEXT
);
CREATE INDEX activity_events_contact ON activity_events(contact_id,occurred_at);
CREATE INDEX activity_events_subject ON activity_events(subject_type,subject_id,occurred_at);

ALTER TABLE contacts ADD COLUMN primary_email_id TEXT;
ALTER TABLE contacts ADD COLUMN merged_into_id TEXT REFERENCES contacts(id);
ALTER TABLE contact_email_addresses ADD COLUMN first_seen_at TEXT;
UPDATE contact_email_addresses SET first_seen_at=created_at WHERE first_seen_at IS NULL;
UPDATE contacts SET primary_email_id=(
  SELECT id FROM contact_email_addresses
  WHERE contact_id=contacts.id ORDER BY created_at,id LIMIT 1
);
CREATE INDEX contacts_merged_into ON contacts(merged_into_id);

CREATE TABLE contact_merges (
  id TEXT PRIMARY KEY,
  survivor_id TEXT NOT NULL REFERENCES contacts(id),
  duplicate_id TEXT NOT NULL REFERENCES contacts(id),
  actor TEXT NOT NULL,
  merged_at TEXT NOT NULL,
  prior_state_json TEXT NOT NULL,
  new_state_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  UNIQUE(duplicate_id)
);

INSERT INTO activity_events(
  id,event_type,actor,occurred_at,subject_type,subject_id,contact_id,
  source_type,source_id,new_state_json,reason
)
SELECT
  'event:baseline:' || id,'conversation.handling_baseline','migration',CURRENT_TIMESTAMP,
  'conversation',id,contact_id,'conversation',id,
  json_object('needs_attention',CASE needs_attention WHEN 1 THEN json('true') ELSE json('false') END),
  'Slice 3A migration baseline. No earlier actor or transition time is claimed.'
FROM conversations;
