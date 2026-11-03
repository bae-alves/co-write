-- OAuth identities linked to accounts. An account has keys, identities or both.
CREATE TABLE oauth_identities (
    provider   TEXT        NOT NULL,
    subject    TEXT        NOT NULL,
    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    login      TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);
CREATE INDEX oauth_identities_user_id ON oauth_identities (user_id);

-- A signed-in user asking to link a provider: the browser carries this one-time intent, not a token.
CREATE TABLE oauth_link_intents (
    intent_hash BYTEA       PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL
);

-- A provider round-trip in progress, keyed by the `state` parameter.
CREATE TABLE oauth_flows (
    state_hash     BYTEA       PRIMARY KEY,
    provider       TEXT        NOT NULL,
    port           INTEGER     NOT NULL,
    code_challenge TEXT        NOT NULL,
    link_user_id   BIGINT      REFERENCES users (id) ON DELETE CASCADE,
    expires_at     TIMESTAMPTZ NOT NULL
);

-- One-time codes handed to the desktop's loopback listener, redeemed together with the PKCE verifier.
CREATE TABLE oauth_codes (
    code_hash      BYTEA       PRIMARY KEY,
    user_id        BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_challenge TEXT        NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL
);
