export interface VMRow {
  id: string;
  name: string;
  ip_address: string;
  status: 'running' | 'stopped' | 'starting' | 'stopping';
  agent_id: string | null;
  agent_version: string | null;
  windows_version: string | null;
  cpu_percent: number;
  ram_percent: number;
  disk_percent: number;
  rdp_status: 'healthy' | 'degraded' | 'unknown' | 'unreachable';
  uptime_seconds: number;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

export interface VMSettingsRow {
  id: string;
  vm_id: string;
  monitoring_enabled: number;
  auto_rdp_recovery: number;
  cpu_warning: number;
  cpu_critical: number;
  ram_warning: number;
  ram_critical: number;
  disk_warning: number;
  disk_critical: number;
  rdp_check_enabled: number;
  rdp_check_interval_minutes: number;
  safe_maintenance_mode: number;
  created_at: string;
  updated_at: string;
}

export interface LogRow {
  id: string;
  vm_id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  created_at: string;
}

export interface CommandRow {
  id: string;
  vm_id: string;
  command: 'restart' | 'shutdown' | 'status' | 'rdp_check';
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'expired';
  created_at: string;
  executed_at: string | null;
  result: string | null;
  timeout_seconds: number;
  expires_at: string | null;
  acknowledged_at: string | null;
  ack_retries: number;
}

export interface CreateVMInput {
  name: string;
  ip_address: string;
  agent_id?: string;
  agent_version?: string;
  windows_version?: string;
}

export interface UpdateVMInput {
  name?: string;
  ip_address?: string;
  status?: 'running' | 'stopped' | 'starting' | 'stopping';
  agent_id?: string;
  agent_version?: string;
  windows_version?: string;
  cpu_percent?: number;
  ram_percent?: number;
  disk_percent?: number;
  rdp_status?: 'healthy' | 'degraded' | 'unknown' | 'unreachable';
  uptime_seconds?: number;
  last_seen?: string;
}

export interface VMSettingsInput {
  monitoring_enabled?: boolean;
  auto_rdp_recovery?: boolean;
  cpu_warning?: number;
  cpu_critical?: number;
  ram_warning?: number;
  ram_critical?: number;
  disk_warning?: number;
  disk_critical?: number;
  rdp_check_enabled?: boolean;
  rdp_check_interval_minutes?: number;
  safe_maintenance_mode?: boolean;
}

export interface CreateLogInput {
  vm_id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface CreateCommandInput {
  vm_id: string;
  command: 'restart' | 'shutdown' | 'status' | 'rdp_check';
}

export interface AgentStatusReportRow {
  id: string;
  vm_id: string;
  agent_id: string;
  cpu_percent: number;
  ram_percent: number;
  disk_percent: number;
  windows_version: string | null;
  agent_version: string | null;
  uptime_seconds: number;
  rdp_status: 'healthy' | 'degraded' | 'unknown' | 'unreachable';
  timestamp: string;
  received_at: string;
}

export interface CreateAgentStatusReportInput {
  vm_id: string;
  agent_id: string;
  cpu_percent: number;
  ram_percent: number;
  disk_percent: number;
  windows_version?: string;
  agent_version?: string;
  uptime_seconds: number;
  rdp_status: 'healthy' | 'degraded' | 'unknown' | 'unreachable';
  timestamp: string;
}

export type AuditEventType =
  | 'vm_created' | 'vm_deleted' | 'vm_updated'
  | 'command_restart' | 'command_shutdown' | 'command_status' | 'command_rdp_check'
  | 'command_completed' | 'command_failed' | 'command_expired' | 'command_acknowledged'
  | 'rdp_recovery_triggered' | 'rdp_recovery_completed' | 'rdp_recovery_failed'
  | 'agent_enrolled' | 'agent_reenrolled' | 'agent_disconnected'
  | 'settings_updated' | 'enrollment_token_created';

export interface AuditLogRow {
  id: string;
  vm_id: string;
  event_type: AuditEventType;
  severity: 'info' | 'warn' | 'error';
  message: string;
  metadata: string | null;
  created_at: string;
}

export interface CreateAuditLogInput {
  vm_id: string;
  event_type: AuditEventType;
  severity: 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface EnrollmentTokenRow {
  id: string;
  vm_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  used_at: string | null;
}

export interface AgentRow {
  id: string;
  vm_id: string;
  agent_id: string;
  credential_hash: string;
  machine_id: string | null;
  hostname: string | null;
  agent_version: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface CreateAgentInput {
  vm_id: string;
  agent_id: string;
  credential_hash: string;
  machine_id?: string;
  hostname?: string;
  agent_version?: string;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: 'admin';
  created_at: string;
  last_login_at: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  session_token_hash: string;
  expires_at: string;
  created_at: string;
  last_used_at: string;
  user_agent: string | null;
  ip_address: string | null;
}

export interface RateLimitRow {
  id: string;
  key: string;
  count: number;
  window_start: string;
  window_seconds: number;
  max_requests: number;
  created_at: string;
}

export interface SystemSettingRow {
  key: string;
  value: string;
  updated_at: string;
}
