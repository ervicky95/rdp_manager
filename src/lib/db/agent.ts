import type { D1Database } from '@cloudflare/workers-types';
import {
  EnrollmentTokenRow,
  AgentRow,
  CreateAgentInput,
} from '@/types/db';
import { generateId, nowISO } from './client';

function castFirst<T>(result: unknown): T | null {
  return (result ?? null) as T | null;
}

/**
 * Repository for enrollment tokens and registered agents.
 *
 * Only digests are stored (see src/lib/crypto.ts). Enrollment tokens are
 * single-use: the row is deleted when consumed. Agent credentials are returned
 * to the agent exactly once at enrollment and are never read back.
 */
export class AgentRepository {
  constructor(private db: D1Database) {}

  // ----- Enrollment tokens -----

  async createEnrollmentToken(opts: {
    vmId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<EnrollmentTokenRow> {
    const id = generateId();
    const now = nowISO();
    await this.db
      .prepare(
        `INSERT INTO enrollment_tokens (id, vm_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, opts.vmId, opts.tokenHash, opts.expiresAt, now)
      .run();
    const created = await this.findEnrollmentTokenById(id);
    if (!created) throw new Error('Failed to create enrollment token');
    return created;
  }

  async findEnrollmentTokenByHash(tokenHash: string): Promise<EnrollmentTokenRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM enrollment_tokens WHERE token_hash = ?')
      .bind(tokenHash)
      .first();
    return castFirst<EnrollmentTokenRow>(result);
  }

  private async findEnrollmentTokenById(id: string): Promise<EnrollmentTokenRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM enrollment_tokens WHERE id = ?')
      .bind(id)
      .first();
    return castFirst<EnrollmentTokenRow>(result);
  }

  /** Consumes an enrollment token (single-use). Returns true if a row was deleted. */
  async consumeEnrollmentToken(id: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM enrollment_tokens WHERE id = ?')
      .bind(id)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  /** Removes tokens for a VM that already expired. */
  async deleteExpiredEnrollmentTokens(nowIso: string): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM enrollment_tokens WHERE expires_at < ?')
      .bind(nowIso)
      .run();
    return result.meta.changes ?? 0;
  }

  // ----- Agents -----

  async createAgent(input: CreateAgentInput): Promise<AgentRow> {
    const id = generateId();
    const now = nowISO();
    await this.db
      .prepare(
        `INSERT INTO agents (id, vm_id, agent_id, credential_hash, machine_id, hostname, agent_version, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.vm_id,
        input.agent_id,
        input.credential_hash,
        input.machine_id ?? null,
        input.hostname ?? null,
        input.agent_version ?? null,
        null,
        now
      )
      .run();
    const created = await this.findAgentByAgentId(input.agent_id);
    if (!created) throw new Error('Failed to create agent');
    return created;
  }

  async findAgentByAgentId(agentId: string): Promise<AgentRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM agents WHERE agent_id = ?')
      .bind(agentId)
      .first();
    return castFirst<AgentRow>(result);
  }

  async findAgentByVmId(vmId: string): Promise<AgentRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM agents WHERE vm_id = ?')
      .bind(vmId)
      .first();
    return castFirst<AgentRow>(result);
  }

  /**
   * Deletes the registered agent for a VM. Used on re-enrollment to rotate the
   * credential (the previous credential is immediately revoked) and on VM
   * deletion cleanup.
   */
  async deleteAgentByVmId(vmId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM agents WHERE vm_id = ?')
      .bind(vmId)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async touchAgent(agentId: string, opts: {
    lastSeenAt: string;
    agentVersion?: string;
  }): Promise<void> {
    if (opts.agentVersion !== undefined) {
      await this.db
        .prepare('UPDATE agents SET last_seen_at = ?, agent_version = ? WHERE agent_id = ?')
        .bind(opts.lastSeenAt, opts.agentVersion, agentId)
        .run();
    } else {
      await this.db
        .prepare('UPDATE agents SET last_seen_at = ? WHERE agent_id = ?')
        .bind(opts.lastSeenAt, agentId)
        .run();
    }
  }
}
