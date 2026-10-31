PRAGMA foreign_keys = ON;

CREATE TABLE reply_drafts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  state TEXT NOT NULL CHECK(state IN ('draft','approved','sending','accepted','failed','indeterminate','cancelled')),
  body TEXT NOT NULL,
  context_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  approved_hash TEXT,
  message_row_id TEXT UNIQUE,
  provider_id TEXT,
  error_code TEXT,
  evidence TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE UNIQUE INDEX reply_one_draft ON reply_drafts(conversation_id) WHERE state IN ('draft','approved');
CREATE INDEX reply_conversation ON reply_drafts(conversation_id,state);

INSERT INTO reply_drafts(id,conversation_id,state,body,context_json,content_hash,message_row_id,
  provider_id,error_code,created_at,updated_at,started_at)
SELECT 'legacy:' || id,conversation_id,CASE WHEN delivery_status='sent' AND message_id IS NOT NULL
  THEN 'accepted' ELSE 'indeterminate' END,text_body,'{}','legacy',id,message_id,
  CASE WHEN delivery_status='sent' AND message_id IS NOT NULL THEN NULL ELSE 'legacy_outcome_unverified' END,
  ingested_at,ingested_at,ingested_at FROM messages WHERE direction='outbound';

UPDATE messages SET delivery_status='sending',delivery_error='legacy_outcome_unverified'
WHERE id IN (SELECT message_row_id FROM reply_drafts WHERE state='indeterminate');
