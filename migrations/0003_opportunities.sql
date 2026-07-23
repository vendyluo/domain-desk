PRAGMA foreign_keys = ON;

CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  desired_outcome TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  state TEXT NOT NULL DEFAULT 'new' CHECK(state IN ('new','qualified','active','won','lost','archived')),
  value_minor INTEGER CHECK(value_minor IS NULL OR value_minor >= 0),
  currency TEXT CHECK(currency IS NULL OR (length(currency)=3 AND currency=upper(currency))),
  outcome_reason TEXT,
  outcome_at TEXT,
  owner_actor TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((value_minor IS NULL)=(currency IS NULL)),
  CHECK(state NOT IN ('won','lost') OR (length(trim(outcome_reason))>0 AND outcome_at IS NOT NULL))
);
CREATE INDEX opportunities_state ON opportunities(state,updated_at);
CREATE INDEX opportunities_contact ON opportunities(contact_id,updated_at);

CREATE TABLE opportunity_contacts (
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(opportunity_id,contact_id)
);
CREATE TABLE opportunity_conversations (
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  mailbox_identity_id TEXT NOT NULL REFERENCES mailbox_identities(id),
  domain_id TEXT NOT NULL REFERENCES domains(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(opportunity_id,conversation_id)
);

ALTER TABLE next_actions ADD COLUMN opportunity_id TEXT REFERENCES opportunities(id);
ALTER TABLE next_actions ADD COLUMN is_designated INTEGER NOT NULL DEFAULT 0 CHECK(is_designated IN (0,1));
CREATE UNIQUE INDEX opportunity_designated_open ON next_actions(opportunity_id) WHERE status='open' AND is_designated=1;

CREATE TABLE activity_events_new (
  id TEXT PRIMARY KEY, event_type TEXT NOT NULL, actor TEXT NOT NULL, occurred_at TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('next_action','conversation','contact','opportunity')),
  subject_id TEXT NOT NULL, contact_id TEXT REFERENCES contacts(id), source_type TEXT, source_id TEXT,
  prior_state_json TEXT, new_state_json TEXT, reason TEXT
);
INSERT INTO activity_events_new SELECT * FROM activity_events;
DROP TABLE activity_events;
ALTER TABLE activity_events_new RENAME TO activity_events;
CREATE INDEX activity_events_contact ON activity_events(contact_id,occurred_at);
CREATE INDEX activity_events_subject ON activity_events(subject_type,subject_id,occurred_at);
