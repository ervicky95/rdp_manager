-- Expand command types and align the table with the command repository.
-- SQLite cannot alter an existing CHECK constraint, so rebuild the table.

CREATE TABLE commands_new (
    id TEXT PRIMARY KEY,
    vm_id TEXT NOT NULL REFERENCES vms(id) ON DELETE CASCADE,

    command TEXT NOT NULL CHECK (
        command IN ('restart', 'shutdown', 'status', 'rdp_check')
    ),

    status TEXT NOT NULL CHECK (
        status IN (
            'pending',
            'sent',
            'acknowledged',
            'executing',
            'completed',
            'failed',
            'expired'
        )
    ),

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    executed_at TEXT,
    result TEXT,
    timeout_seconds INTEGER DEFAULT 300,
    expires_at TEXT,
    acknowledged_at TEXT,
    ack_retries INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO commands_new (
    id,
    vm_id,
    command,
    status,
    created_at,
    executed_at,
    result,
    timeout_seconds,
    expires_at,
    acknowledged_at,
    ack_retries,
    updated_at
)
SELECT
    id,
    vm_id,
    command,
    status,
    created_at,
    executed_at,
    result,
    timeout_seconds,
    expires_at,
    acknowledged_at,
    ack_retries,
    COALESCE(created_at, datetime('now'))
FROM commands;

DROP TABLE commands;

ALTER TABLE commands_new RENAME TO commands;

CREATE INDEX idx_commands_vm_id_status
    ON commands(vm_id, status);

CREATE INDEX idx_commands_created_at
    ON commands(created_at DESC);

CREATE INDEX idx_commands_expires_at
    ON commands(expires_at);

CREATE INDEX idx_commands_vm_id_expires
    ON commands(vm_id, expires_at);
