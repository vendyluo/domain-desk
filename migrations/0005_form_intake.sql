PRAGMA foreign_keys = ON;

ALTER TABLE messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'email' CHECK(channel IN ('email','form'));
