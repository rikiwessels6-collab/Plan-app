-- Plan backend: people, their devices, the documents (boards) they can open, and photos.
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
-- one row per signed-in device; only a hash of the device's secret is kept
CREATE TABLE keys (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX keys_user ON keys(user_id);
-- short-lived codes for adding another device to the same person
CREATE TABLE links (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
-- a document is one board; rev increases on every write so two writers cannot silently overwrite each other
CREATE TABLE docs (id TEXT PRIMARY KEY, body TEXT NOT NULL, rev INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE members (doc_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined INTEGER NOT NULL, PRIMARY KEY (doc_id, user_id));
CREATE INDEX members_user ON members(user_id);
CREATE TABLE invites (token TEXT PRIMARY KEY, doc_id TEXT NOT NULL, created_by TEXT NOT NULL, expires INTEGER NOT NULL);
-- photos are stored apart from the board text, addressed by a hash of their contents
CREATE TABLE blobs (doc_id TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (doc_id, hash));
