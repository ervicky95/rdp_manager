-- Initial schema for RDP Manager D1 database

-- VMs table
CREATE TABLE vms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    ip_address TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'stopped', 'starting', 'stopping')),
    agent_id TEXT,
    agent_version TEXT,
    windows_version TEXT,
    cpu_percent INTEGER DEFAULT 0 CHECK (cpu_percent >= 0 AND cpu_percent <= 100),
    ram_percent INTEGER DEFAULT 0 CHECK (ram_percent >= 0 AND ram_percent <= 100),
    disk_percent INTEGER DEFAULT 0 CHECK (disk_percent >= 0 AND disk_percent <= 100),
    rdp_status TEXT NOT NULL CHECK (rdp_status IN ('healthy', 'degraded', 'unknown', 'unreachable')),
    uptime_seconds INTEGER DEFAULT 0,
    last_seen TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- VM Settings table
CREATE TABLE vm_settings (
    id TEXT PRIMARY KEY,
    vm_id TEXT NOT NULL UNIQUE REFERENCES vms(id) ON DELETE CASCADE,
    monitoring_enabled INTEGER NOT NULL DEFAULT 1 CHECK (monitoring_enabled IN (0, 1)),
    auto_rdp_recovery INTEGER NOT NULL DEFAULT 1 CHECK (auto_rdp_recovery IN (0, 1)),
    cpu_warning INTEGER NOT NULL DEFAULT 70 CHECK (cpu_warning >= 0 AND cpu_warning <= 100),
    cpu_critical INTEGER NOT NULL DEFAULT 90 CHECK (cpu_critical >= 0 AND cpu_critical <= 100),
    ram_warning INTEGER NOT NULL DEFAULT 75 CHECK (ram_warning >= 0 AND ram_warning <= 100),
    ram_critical INTEGER NOT NULL DEFAULT 90 CHECK (ram_critical >= 0 AND ram_critical <= 100),
    disk_warning INTEGER NOT NULL DEFAULT 80 CHECK (disk_warning >= 0 AND disk_warning <= 100),
    disk_critical INTEGER NOT NULL DEFAULT 95 CHECK (disk_critical >= 0 AND disk_critical <= 100),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Logs table
CREATE TABLE logs (
    id TEXT PRIMARY KEY,
    vm_id TEXT NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Commands table
CREATE TABLE commands (
    id TEXT PRIMARY KEY,
    vm_id TEXT NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
    command TEXT NOT NULL CHECK (command IN ('restart', 'shutdown')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'acknowledged', 'completed', 'failed', 'expired')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    executed_at TEXT,
    result TEXT
);

-- Indexes for performance
CREATE INDEX idx_vms_status ON vms(status);
CREATE INDEX idx_vms_agent_id ON vms(agent_id);
CREATE INDEX idx_vms_last_seen ON vms(last_seen);
CREATE INDEX idx_logs_vm_id_timestamp ON logs(vm_id, timestamp DESC);
CREATE INDEX idx_commands_vm_id_status ON commands(vm_id, status);
CREATE INDEX idx_commands_created_at ON commands(created_at DESC);

-- Trigger to update updated_at timestamp on vms
CREATE TRIGGER update_vms_updated_at
AFTER UPDATE ON vms
BEGIN
    UPDATE vms SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Trigger to update updated_at timestamp on vm_settings
CREATE TRIGGER update_vm_settings_updated_at
AFTER UPDATE ON vm_settings
BEGIN
    UPDATE vm_settings SET updated_at = datetime('now') WHERE id = NEW.id;
END;