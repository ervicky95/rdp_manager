-- Phase 4: Enrollment tokens and registered agents.
-- Enrollment tokens are single-use and expiring; the server stores only an
-- HMAC-SHA256 hash (keyed by ENROLLMENT_TOKEN_SECRET), never the plaintext.
-- Agent credentials are stored only as HMAC-SHA256 hashes (keyed by
-- AGENT_CREDENTIAL_SECRET). The plaintext credential is returned to the agent
-- exactly once, during enrollment, and is never persisted or exposed to the
-- browser.

CREATE TABLE enrollment_tokens (
    id TEXT PRIMARY KEY,
    vm_id TEXT NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    used_at TEXT
);

CREATE TABLE agents (
    id TEXT PRIMARY KEY,              -- stable row id
    vm_id TEXT NOT NULL UNIQUE REFERENCES vms(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL UNIQUE,    -- public identifier sent by the agent
    credential_hash TEXT NOT NULL,    -- HMAC-SHA256(query:credential) keyed by AGENT_CREDENTIAL_SECRET
    machine_id TEXT,
    hostname TEXT,
    agent_version TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_enrollment_tokens_vm_id ON enrollment_tokens(vm_id);
CREATE INDEX idx_enrollment_tokens_expires_at ON enrollment_tokens(expires_at);
CREATE INDEX idx_agents_vm_id ON agents(vm_id);
CREATE INDEX idx_agents_last_seen ON agents(last_seen_at);

-- commands already exists in 0001 but lacked updated_at, which the poll
-- acknowledgement path relies on (VMRepository.updateCommandStatus).
ALTER TABLE commands ADD COLUMN updated_at TEXT;
