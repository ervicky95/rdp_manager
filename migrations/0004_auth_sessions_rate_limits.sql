-- Phase 7: Authentication, sessions, rate limits, and system settings

-- Users table (admin only for Phase 7)
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
);

CREATE INDEX idx_users_email ON users(email);

-- Sessions table for server-side session management
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_sessions_token_hash ON sessions(session_token_hash);

-- Rate limits table for sensitive operations
CREATE TABLE rate_limits (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    window_start TEXT NOT NULL,
    window_seconds INTEGER NOT NULL,
    max_requests INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_rate_limits_key_window ON rate_limits(key, window_start);

-- System settings table for bootstrap state and configuration
CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trigger to update system_settings updated_at
CREATE TRIGGER update_system_settings_updated_at
AFTER UPDATE ON system_settings
BEGIN
    UPDATE system_settings SET updated_at = datetime('now') WHERE key = NEW.key;
END;