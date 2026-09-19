-- Phase 6: Command API enhancements, status command, logs, audit events

-- Add command fields for timeout/expiration tracking
ALTER TABLE commands ADD COLUMN timeout_seconds INTEGER DEFAULT 300;
ALTER TABLE commands ADD COLUMN expires_at TEXT;
ALTER TABLE commands ADD COLUMN acknowledged_at TEXT;
ALTER TABLE commands ADD COLUMN ack_retries INTEGER DEFAULT 0;

-- Index for command timeout scanning
CREATE INDEX idx_commands_expires_at ON commands(expires_at);
CREATE INDEX idx_commands_vm_id_expires ON commands(vm_id, expires_at);

-- Agent status reports table (for fresh status from agent)
CREATE TABLE agent_status_reports (
    id TEXT PRIMARY KEY,
    vm_id TEXT NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    cpu_percent INTEGER NOT NULL CHECK (cpu_percent >= 0 AND cpu_percent <= 100),
    ram_percent INTEGER NOT NULL CHECK (ram_percent >= 0 AND ram_percent <= 100),
    disk_percent INTEGER NOT NULL CHECK (disk_percent >= 0 AND disk_percent <= 100),
    windows_version TEXT,
    agent_version TEXT,
    uptime_seconds INTEGER NOT NULL,
    rdp_status TEXT NOT NULL CHECK (rdp_status IN ('healthy', 'degraded', 'unknown', 'unreachable')),
    timestamp TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_agent_status_vm_id ON agent_status_reports(vm_id);
CREATE INDEX idx_agent_status_received ON agent_status_reports(received_at DESC);

-- Audit log table for important events
CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    vm_id TEXT NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'vm_created', 'vm_deleted', 'vm_updated',
        'command_restart', 'command_shutdown', 'command_status', 'command_rdp_check',
        'command_completed', 'command_failed', 'command_expired', 'command_acknowledged',
        'rdp_recovery_triggered', 'rdp_recovery_completed', 'rdp_recovery_failed',
        'agent_enrolled', 'agent_reenrolled', 'agent_disconnected',
        'settings_updated', 'enrollment_token_created'
    )),
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
    message TEXT NOT NULL,
    metadata TEXT, -- JSON for additional context
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_logs_vm_id ON audit_logs(vm_id);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Trigger to update commands updated_at (already exists on vms, but ensure commands has it)
-- Note: D1 doesn't support triggers on all tables the same way, we handle updated_at in code