-- Single-use tickets that let a WebSocket connect to one document, so the session token never
-- appears in a URL or a proxy log. Only the SHA-256 is stored.
CREATE TABLE ws_tickets (
    ticket_hash BYTEA       PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    document_id TEXT        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL
);
