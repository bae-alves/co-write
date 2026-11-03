-- Key-based accounts replace passwords. Nothing is deployed, so existing password accounts are
-- dropped; their sessions, documents, memberships and update logs go with them (ON DELETE CASCADE).
DELETE FROM users;
ALTER TABLE users DROP COLUMN password_hash;

-- Ed25519 public keys (SPKI DER). An account can have several, e.g. one per machine.
CREATE TABLE account_keys (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    public_key  BYTEA       NOT NULL UNIQUE,
    fingerprint TEXT        NOT NULL,
    label       TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_keys_user_id ON account_keys (user_id);

-- A session created by signing in with a key ends when that key is removed.
ALTER TABLE sessions ADD COLUMN key_id BIGINT REFERENCES account_keys (id) ON DELETE CASCADE;

-- Single-use nonces clients sign to register or sign in. Only the SHA-256 is stored.
CREATE TABLE login_challenges (
    nonce_hash BYTEA       PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);
