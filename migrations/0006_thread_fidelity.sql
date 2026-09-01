PRAGMA foreign_keys = ON;

-- RFC 5322 message ids are case-sensitive, but message_id/references_json store
-- normalized (lowercased) values for matching. Keep the original casing so
-- outbound replies can emit headers the recipient's client actually matches.
ALTER TABLE messages ADD COLUMN message_id_raw TEXT;
ALTER TABLE messages ADD COLUMN references_raw_json TEXT;

CREATE INDEX messages_conversation ON messages(conversation_id, received_at);
