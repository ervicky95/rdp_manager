export interface VM {
  id: string;
  name: string;
  ip: string;
  status: 'running' | 'stopped' | 'starting' | 'stopping';
  os: string;
  agentVersion: string;
  lastSeen: string;
  rdpHealth: 'healthy' | 'degraded' | 'unknown' | 'unreachable';
  cpu: number;
  ram: number;
  disk: number;
  createdAt: string;
}

export interface VMFormData {
  name: string;
  ip: string;
}

export type VMAction = 'restart' | 'shutdown' | 'status' | 'rdp_check' | 'logs' | 'settings' | 'delete';

export interface Command {
  id: string;
  vmId: string;
  command: 'restart' | 'shutdown' | 'status' | 'rdp_check';
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'expired';
  createdAt: string;
  executedAt: string | null;
  result: string | null;
  timeoutSeconds: number;
  expiresAt: string | null;
  acknowledgedAt: string | null;
  ackRetries: number;
}

export interface AuditLog {
  id: string;
  vmId: string;
  eventType: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface LogEntry {
  id: string;
  vmId: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  createdAt: string;
}