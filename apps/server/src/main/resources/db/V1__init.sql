-- Accounts. Usernames are stored lower-case; passwords as PBKDF2 hashes.
CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bearer sessions. Only the SHA-256 of the token is stored.
CREATE TABLE sessions (
    token_hash BYTEA       PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_id ON sessions (user_id);

CREATE TABLE documents (
    id         TEXT        PRIMARY KEY,
    title      TEXT        NOT NULL,
    owner_id   BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who may open a document, and how. The owner has a row too.
CREATE TABLE document_members (
    document_id TEXT   NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role        TEXT   NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    PRIMARY KEY (document_id, user_id)
);
CREATE INDEX document_members_user_id ON document_members (user_id);

-- The Yjs update log per document: opaque binary updates, compacted into snapshots over time.
CREATE TABLE document_updates (
    document_id TEXT   NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    seq         BIGINT NOT NULL,
    data        BYTEA  NOT NULL,
    PRIMARY KEY (document_id, seq)
);
