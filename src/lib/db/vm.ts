import type { D1Database, D1Result } from '@cloudflare/workers-types';
import type {
  VMRow,
  CreateVMInput,
  UpdateVMInput,
  VMSettingsRow,
  VMSettingsInput,
  LogRow,
  CreateLogInput,
  CommandRow,
  CreateCommandInput,
  AgentStatusReportRow,
  CreateAgentStatusReportInput,
  AuditLogRow,
  CreateAuditLogInput,
} from '@/types/db';
import { generateId, nowISO } from './client';

function castResults<T>(results: D1Result<unknown>['results']): T[] {
  return (results ?? []) as unknown as T[];
}

function castFirst<T>(result: D1Result<unknown>['results'][number] | null): T | null {
  return result as unknown as T | null;
}

export class VMRepository {
  constructor(private db: D1Database) {}

  async findAll(): Promise<VMRow[]> {
    const { results } = await this.db.prepare('SELECT * FROM vms ORDER BY created_at DESC').all();
    return castResults<VMRow>(results);
  }

  async findById(id: string): Promise<VMRow | null> {
    const result = await this.db.prepare('SELECT * FROM vms WHERE id = ?').bind(id).first();
    return castFirst<VMRow>(result);
  }

  async findByName(name: string): Promise<VMRow | null> {
    const result = await this.db.prepare('SELECT * FROM vms WHERE name = ?').bind(name).first();
    return castFirst<VMRow>(result);
  }

  async findByAgentId(agentId: string): Promise<VMRow | null> {
    const result = await this.db.prepare('SELECT * FROM vms WHERE agent_id = ?').bind(agentId).first();
    return castFirst<VMRow>(result);
  }

  async create(input: CreateVMInput): Promise<VMRow> {
    const id = generateId();
    const now = nowISO();

    await this.db
      .prepare(
        `INSERT INTO vms (id, name, ip_address, status, agent_id, agent_version, windows_version, cpu_percent, ram_percent, disk_percent, rdp_status, uptime_seconds, last_seen, created_at, updated_at)
         VALUES (?, ?, ?, 'stopped', ?, ?, ?, 0, 0, 0, 'unknown', 0, ?, ?, ?)`
      )
      .bind(id, input.name, input.ip_address, input.agent_id || null, input.agent_version || null, input.windows_version || null, now, now, now)
      .run();

    // Create default settings
    await this.db
      .prepare(
        `INSERT INTO vm_settings (id, vm_id, monitoring_enabled, auto_rdp_recovery, cpu_warning, cpu_critical, ram_warning, ram_critical, disk_warning, disk_critical, rdp_check_enabled, rdp_check_interval_minutes, safe_maintenance_mode, created_at, updated_at)
         VALUES (?, ?, 1, 1, 70, 90, 75, 90, 80, 95, 1, 5, 0, ?, ?)`
      )
      .bind(generateId(), id, now, now)
      .run();

    const vm = await this.findById(id);
    if (!vm) throw new Error('Failed to create VM');
    return vm;
  }

  async update(id: string, input: UpdateVMInput): Promise<VMRow | null> {
    const vm = await this.findById(id);
    if (!vm) return null;

    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.ip_address !== undefined) { fields.push('ip_address = ?'); values.push(input.ip_address); }
    if (input.status !== undefined) { fields.push('status = ?'); values.push(input.status); }
    if (input.agent_id !== undefined) { fields.push('agent_id = ?'); values.push(input.agent_id); }
    if (input.agent_version !== undefined) { fields.push('agent_version = ?'); values.push(input.agent_version); }
    if (input.windows_version !== undefined) { fields.push('windows_version = ?'); values.push(input.windows_version); }
    if (input.cpu_percent !== undefined) { fields.push('cpu_percent = ?'); values.push(input.cpu_percent); }
    if (input.ram_percent !== undefined) { fields.push('ram_percent = ?'); values.push(input.ram_percent); }
    if (input.disk_percent !== undefined) { fields.push('disk_percent = ?'); values.push(input.disk_percent); }
    if (input.rdp_status !== undefined) { fields.push('rdp_status = ?'); values.push(input.rdp_status); }
    if (input.uptime_seconds !== undefined) { fields.push('uptime_seconds = ?'); values.push(input.uptime_seconds); }
    if (input.last_seen !== undefined) { fields.push('last_seen = ?'); values.push(input.last_seen); }

    if (fields.length === 0) return vm;

    fields.push('updated_at = ?');
    values.push(nowISO());
    values.push(id);

    await this.db.prepare(`UPDATE vms SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM vms WHERE id = ?').bind(id).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async getSettings(vmId: string): Promise<VMSettingsRow | null> {
    const result = await this.db.prepare('SELECT * FROM vm_settings WHERE vm_id = ?').bind(vmId).first();
    return castFirst<VMSettingsRow>(result);
  }

  async updateSettings(vmId: string, input: VMSettingsInput): Promise<VMSettingsRow | null> {
    const settings = await this.getSettings(vmId);
    if (!settings) return null;

    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (input.monitoring_enabled !== undefined) { fields.push('monitoring_enabled = ?'); values.push(input.monitoring_enabled ? 1 : 0); }
    if (input.auto_rdp_recovery !== undefined) { fields.push('auto_rdp_recovery = ?'); values.push(input.auto_rdp_recovery ? 1 : 0); }
    if (input.cpu_warning !== undefined) { fields.push('cpu_warning = ?'); values.push(input.cpu_warning); }
    if (input.cpu_critical !== undefined) { fields.push('cpu_critical = ?'); values.push(input.cpu_critical); }
    if (input.ram_warning !== undefined) { fields.push('ram_warning = ?'); values.push(input.ram_warning); }
    if (input.ram_critical !== undefined) { fields.push('ram_critical = ?'); values.push(input.ram_critical); }
    if (input.disk_warning !== undefined) { fields.push('disk_warning = ?'); values.push(input.disk_warning); }
    if (input.disk_critical !== undefined) { fields.push('disk_critical = ?'); values.push(input.disk_critical); }
    if (input.rdp_check_enabled !== undefined) { fields.push('rdp_check_enabled = ?'); values.push(input.rdp_check_enabled ? 1 : 0); }
    if (input.rdp_check_interval_minutes !== undefined) { fields.push('rdp_check_interval_minutes = ?'); values.push(input.rdp_check_interval_minutes); }
    if (input.safe_maintenance_mode !== undefined) { fields.push('safe_maintenance_mode = ?'); values.push(input.safe_maintenance_mode ? 1 : 0); }

    if (fields.length === 0) return settings;

    fields.push('updated_at = ?');
    values.push(nowISO());
    values.push(vmId);

    await this.db.prepare(`UPDATE vm_settings SET ${fields.join(', ')} WHERE vm_id = ?`).bind(...values).run();
    return this.getSettings(vmId);
  }

  async getStats() {
    const { results } = await this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END) as stopped,
        SUM(CASE WHEN rdp_status = 'healthy' THEN 1 ELSE 0 END) as healthy
      FROM vms
    `).all();
    return castResults<{ total: number; running: number; stopped: number; healthy: number }>(results)[0];
  }

  // ---- Command enhancements for Phase 6 ----

  /**
   * Creates a new command with validation, duplicate prevention, and expiration.
   * Only allows one pending/executing command of the same type per VM.
   */
  async createCommand(input: CreateCommandInput): Promise<CommandRow> {
    const { vm_id, command } = input;

    // Validate command type
    const allowedCommands = ['restart', 'shutdown', 'status', 'rdp_check'];
    if (!allowedCommands.includes(command)) {
      throw new Error(`Invalid command: ${command}. Allowed: ${allowedCommands.join(', ')}`);
    }

    const now = nowISO();
    const timeoutSeconds = command === 'status' ? 30 : command === 'rdp_check' ? 30 : 300;
    const expiresAt = new Date(Date.now() + timeoutSeconds * 1000).toISOString();

    // Duplicate prevention: check for existing pending/executing command of same type
    const existing = await this.db
      .prepare(
        `SELECT id FROM commands
         WHERE vm_id = ? AND command = ? AND status IN ('pending', 'executing')
         ORDER BY created_at DESC LIMIT 1`
      )
      .bind(vm_id, command)
      .first();

    if (existing) {
      // Return existing command instead of creating duplicate
      const result = await this.db.prepare('SELECT * FROM commands WHERE id = ?').bind(existing.id).first();
      return castFirst<CommandRow>(result)!;
    }

    const id = generateId();
    await this.db
      .prepare(
        `INSERT INTO commands (id, vm_id, command, status, created_at, timeout_seconds, expires_at, ack_retries)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, 0)`
      )
      .bind(id, vm_id, command, now, timeoutSeconds, expiresAt)
      .run();

    const result = await this.db.prepare('SELECT * FROM commands WHERE id = ?').bind(id).first();
    return castFirst<CommandRow>(result)!;
  }

  async getCommandById(id: string): Promise<CommandRow | null> {
    const result = await this.db.prepare('SELECT * FROM commands WHERE id = ?').bind(id).first();
    return castFirst<CommandRow>(result);
  }

  async getCommands(vmId: string, status?: string): Promise<CommandRow[]> {
    let query = 'SELECT * FROM commands WHERE vm_id = ?';
    const params: (string | number)[] = [vmId];
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC';
    const { results } = await this.db.prepare(query).bind(...params).all();
    return castResults<CommandRow>(results);
  }

  async getPendingCommands(vmId: string): Promise<CommandRow[]> {
    const now = nowISO();
    // Return commands that are pending and not expired
    const { results } = await this.db
      .prepare(
        `SELECT * FROM commands
         WHERE vm_id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at ASC`
      )
      .bind(vmId, now)
      .all();
    return castResults<CommandRow>(results);
  }

  async getExecutingCommands(vmId: string): Promise<CommandRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM commands WHERE vm_id = ? AND status = 'executing' ORDER BY created_at ASC`
      )
      .bind(vmId)
      .all();
    return castResults<CommandRow>(results);
  }

  async updateCommandStatus(
    id: string,
    status: CommandRow['status'],
    executedAt?: string,
    result?: string
  ): Promise<CommandRow | null> {
    const fields = ['status = ?', 'updated_at = ?'];
    const values: (string | null)[] = [status, nowISO()];
    if (executedAt) {
      fields.push('executed_at = ?');
      values.push(executedAt);
    }
    if (result) {
      fields.push('result = ?');
      values.push(result);
    }
    if (status === 'executing') {
      fields.push('acknowledged_at = ?');
      values.push(nowISO());
    }
    values.push(id);

    await this.db.prepare(`UPDATE commands SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    const cmdResult = await this.db.prepare('SELECT * FROM commands WHERE id = ?').bind(id).first();
    return castFirst<CommandRow>(cmdResult);
  }

  async acknowledgeCommand(id: string): Promise<CommandRow | null> {
    const now = nowISO();
    await this.db
      .prepare(
        `UPDATE commands SET status = 'executing', acknowledged_at = ?, ack_retries = ack_retries + 1, updated_at = ? WHERE id = ? AND status = 'pending'`
      )
      .bind(now, now, id)
      .run();
    const result = await this.db.prepare('SELECT * FROM commands WHERE id = ?').bind(id).first();
    return castFirst<CommandRow>(result);
  }

  /**
   * Marks expired commands (pending but past expires_at) as expired.
   * Called periodically or on poll.
   */
  async expireCommands(vmId: string): Promise<number> {
    const now = nowISO();
    const result = await this.db
      .prepare(
        `UPDATE commands SET status = 'expired', updated_at = ? WHERE vm_id = ? AND status = 'pending' AND expires_at < ?`
      )
      .bind(now, vmId, now)
      .run();
    return result.meta.changes ?? 0;
  }

  // ---- Agent Status Reports ----

  async createAgentStatusReport(input: CreateAgentStatusReportInput): Promise<AgentStatusReportRow> {
    const id = generateId();
    const now = nowISO();
    await this.db
      .prepare(
        `INSERT INTO agent_status_reports (id, vm_id, agent_id, cpu_percent, ram_percent, disk_percent, windows_version, agent_version, uptime_seconds, rdp_status, timestamp, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.vm_id,
        input.agent_id,
        input.cpu_percent,
        input.ram_percent,
        input.disk_percent,
        input.windows_version ?? null,
        input.agent_version ?? null,
        input.uptime_seconds,
        input.rdp_status,
        input.timestamp,
        now
      )
      .run();

    // Update VM with fresh status
    await this.db
      .prepare(
        `UPDATE vms SET status = 'running', cpu_percent = ?, ram_percent = ?, disk_percent = ?, windows_version = ?, uptime_seconds = ?, rdp_status = ?, last_seen = ?, updated_at = ? WHERE id = ?`
      )
      .bind(
        input.cpu_percent,
        input.ram_percent,
        input.disk_percent,
        input.windows_version ?? null,
        input.uptime_seconds,
        input.rdp_status,
        input.timestamp,
        now,
        input.vm_id
      )
      .run();

    const result = await this.db.prepare('SELECT * FROM agent_status_reports WHERE id = ?').bind(id).first();
    return castFirst<AgentStatusReportRow>(result)!;
  }

  async getLatestStatusReport(vmId: string): Promise<AgentStatusReportRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM agent_status_reports WHERE vm_id = ? ORDER BY received_at DESC LIMIT 1')
      .bind(vmId)
      .first();
    return castFirst<AgentStatusReportRow>(result);
  }

  // ---- Audit Logs ----

  async createAuditLog(input: CreateAuditLogInput): Promise<AuditLogRow> {
    const id = generateId();
    const now = nowISO();
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
    await this.db
      .prepare(
        `INSERT INTO audit_logs (id, vm_id, event_type, severity, message, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, input.vm_id, input.event_type, input.severity, input.message, metadata, now)
      .run();

    const result = await this.db.prepare('SELECT * FROM audit_logs WHERE id = ?').bind(id).first();
    return castFirst<AuditLogRow>(result)!;
  }

  async getAuditLogs(vmId: string, limit = 100, offset = 0): Promise<AuditLogRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM audit_logs WHERE vm_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .bind(vmId, limit, offset)
      .all();
    return castResults<AuditLogRow>(results);
  }

  // ---- Text Logs (INFO, WARN, ERROR) ----

  async createLog(input: CreateLogInput): Promise<LogRow> {
    const id = generateId();
    await this.db
      .prepare('INSERT INTO logs (id, vm_id, timestamp, level, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, input.vm_id, input.timestamp, input.level, input.message, nowISO())
      .run();
    const result = await this.db.prepare('SELECT * FROM logs WHERE id = ?').bind(id).first();
    return castFirst<LogRow>(result)!;
  }

  async getLogs(vmId: string, limit = 100, offset = 0, level?: string): Promise<LogRow[]> {
    let query = 'SELECT * FROM logs WHERE vm_id = ?';
    const params: (string | number)[] = [vmId];
    if (level) {
      query += ' AND level = ?';
      params.push(level);
    }
    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const { results } = await this.db.prepare(query).bind(...params).all();
    return castResults<LogRow>(results);
  }

  /**
   * Deletes logs older than the specified number of days.
   * Returns the number of deleted rows.
   */
  async deleteOldLogs(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.db
      .prepare('DELETE FROM logs WHERE timestamp < ?')
      .bind(cutoff)
      .run();
    return result.meta.changes ?? 0;
  }

  /**
   * Deletes audit logs older than the specified number of days.
   * Returns the number of deleted rows.
   */
  async deleteOldAuditLogs(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.db
      .prepare('DELETE FROM audit_logs WHERE created_at < ?')
      .bind(cutoff)
      .run();
    return result.meta.changes ?? 0;
  }

  /**
   * Deletes agent status reports older than the specified number of days.
   * Returns the number of deleted rows.
   */
  async deleteOldAgentStatusReports(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.db
      .prepare('DELETE FROM agent_status_reports WHERE received_at < ?')
      .bind(cutoff)
      .run();
    return result.meta.changes ?? 0;
  }

  /**
   * Gets VMs with optional filtering and sorting.
   */
  async findAllFiltered(options: {
    search?: string;
    status?: 'all' | 'running' | 'stopped' | 'starting' | 'stopping';
    rdpStatus?: 'all' | 'healthy' | 'degraded' | 'unknown' | 'unreachable';
    onlineOnly?: boolean;
    sortBy?: 'name' | 'cpu_percent' | 'ram_percent' | 'disk_percent' | 'last_seen' | 'created_at';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }): Promise<VMRow[]> {
    const {
      search,
      status = 'all',
      rdpStatus = 'all',
      onlineOnly = false,
      sortBy = 'created_at',
      sortOrder = 'desc',
      limit = 100,
      offset = 0,
    } = options;

    let query = 'SELECT * FROM vms WHERE 1=1';
    const params: (string | number)[] = [];

    if (search) {
      query += ' AND (name LIKE ? OR ip_address LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    if (status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    if (rdpStatus !== 'all') {
      query += ' AND rdp_status = ?';
      params.push(rdpStatus);
    }

    if (onlineOnly) {
      // Online: last_seen within 5 minutes (300 seconds)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      query += ' AND last_seen > ?';
      params.push(fiveMinutesAgo);
    }

    // Validate sortBy to prevent SQL injection
    const allowedSortColumns = ['name', 'cpu_percent', 'ram_percent', 'disk_percent', 'last_seen', 'created_at'];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${safeSortBy} ${safeSortOrder} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const { results } = await this.db.prepare(query).bind(...params).all();
    return castResults<VMRow>(results);
  }

  /**
   * Counts VMs with optional filtering (for pagination).
   */
  async countFiltered(options: {
    search?: string;
    status?: 'all' | 'running' | 'stopped' | 'starting' | 'stopping';
    rdpStatus?: 'all' | 'healthy' | 'degraded' | 'unknown' | 'unreachable';
    onlineOnly?: boolean;
  }): Promise<number> {
    const { search, status = 'all', rdpStatus = 'all', onlineOnly = false } = options;

    let query = 'SELECT COUNT(*) as count FROM vms WHERE 1=1';
    const params: (string | number)[] = [];

    if (search) {
      query += ' AND (name LIKE ? OR ip_address LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    if (status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    if (rdpStatus !== 'all') {
      query += ' AND rdp_status = ?';
      params.push(rdpStatus);
    }

    if (onlineOnly) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      query += ' AND last_seen > ?';
      params.push(fiveMinutesAgo);
    }

    const result = await this.db.prepare(query).bind(...params).first();
    return (result as any)?.count ?? 0;
  }
}