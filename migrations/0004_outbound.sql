PRAGMA foreign_keys = ON;

ALTER TABLE messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'inbound' CHECK(direction IN ('inbound','outbound'));
ALTER TABLE messages ADD COLUMN delivery_status TEXT CHECK(delivery_status IS NULL OR delivery_status IN ('sending','sent','failed'));
ALTER TABLE messages ADD COLUMN delivery_error TEXT;
