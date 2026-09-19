import type { D1Database, D1Result } from '@cloudflare/workers-types';
import type {
  UserRow,
  SessionRow,
  RateLimitRow,
  SystemSettingRow,
} from '@/types/db';
import { generateId, nowISO } from './client';

function castFirst<T>(result: unknown): T | null {
  return (result ?? null) as T | null;
}

function castResults<T>(results: D1Result<unknown>['results']): T[] {
  return (results ?? []) as unknown as T[];
}

export class AuthRepository {
  constructor(private readonly db: D1Database) {}

  getDb(): D1Database {
    return this.db;
  }

  // ----- Users -----

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first();
    return castFirst<UserRow>(result);
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(id)
      .first();
    return castFirst<UserRow>(result);
  }

  async findAnyAdmin(): Promise<UserRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE role = ? LIMIT 1')
      .bind('admin')
      .first();
    return castFirst<UserRow>(result);
  }

  async createUser(input: {
    email: string;
    passwordHash: string;
    role: 'admin';
  }): Promise<UserRow> {
    const id = generateId();
    const now = nowISO();
    await this.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, role, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, NULL)`
      )
      .bind(id, input.email, input.passwordHash, input.role, now)
      .run();
    const created = await this.findUserById(id);
    if (!created) throw new Error('Failed to create user');
    return created;
  }

  async updateLastLogin(userId: string): Promise<void> {
    const now = nowISO();
    await this.db
      .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .bind(now, userId)
      .run();
  }

  // ----- Sessions -----

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<SessionRow> {
    const id = generateId();
    const now = nowISO();
    await this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, session_token_hash, expires_at, created_at, last_used_at, user_agent, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, input.userId, input.tokenHash, input.expiresAt, now, now, input.userAgent, input.ipAddress)
      .run();
    const created = await this.findSessionById(id);
    if (!created) throw new Error('Failed to create session');
    return created;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM sessions WHERE session_token_hash = ?')
      .bind(tokenHash)
      .first();
    return castFirst<SessionRow>(result);
  }

  private async findSessionById(id: string): Promise<SessionRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .bind(id)
      .first();
    return castFirst<SessionRow>(result);
  }

  async findSessionWithUser(tokenHash: string): Promise<(SessionRow & UserRow) | null> {
    const result = await this.db
      .prepare(
        `SELECT s.*, u.email, u.password_hash, u.role, u.created_at as user_created_at, u.last_login_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.session_token_hash = ?`
      )
      .bind(tokenHash)
      .first();
    return castFirst<SessionRow & UserRow>(result);
  }

  async updateSessionLastUsed(sessionId: string): Promise<void> {
    const now = nowISO();
    await this.db
      .prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?')
      .bind(now, sessionId)
      .run();
  }

  async deleteSession(tokenHash: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM sessions WHERE session_token_hash = ?')
      .bind(tokenHash)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async deleteAllUserSessions(userId: string): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM sessions WHERE user_id = ?')
      .bind(userId)
      .run();
    return result.meta.changes ?? 0;
  }

  async deleteExpiredSessions(nowIso: string): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .bind(nowIso)
      .run();
    return result.meta.changes ?? 0;
  }

  // ----- Rate Limits -----

  async findRateLimitBucket(key: string, windowStart: string): Promise<RateLimitRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM rate_limits WHERE key = ? AND window_start = ?')
      .bind(key, windowStart)
      .first();
    return castFirst<RateLimitRow>(result);
  }

  async createRateLimitBucket(input: {
    key: string;
    windowStart: string;
    windowSeconds: number;
    maxRequests: number;
  }): Promise<RateLimitRow> {
    const id = generateId();
    const now = nowISO();
    await this.db
      .prepare(
        `INSERT INTO rate_limits (id, key, count, window_start, window_seconds, max_requests, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?)`
      )
      .bind(id, input.key, input.windowStart, input.windowSeconds, input.maxRequests, now)
      .run();
    const created = await this.findRateLimitBucket(input.key, input.windowStart);
    if (!created) throw new Error('Failed to create rate limit bucket');
    return created;
  }

  async incrementRateLimit(id: string): Promise<void> {
    await this.db
      .prepare('UPDATE rate_limits SET count = count + 1 WHERE id = ?')
      .bind(id)
      .run();
  }

  async deleteOldRateLimits(cutoffIso: string): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM rate_limits WHERE window_start < ?')
      .bind(cutoffIso)
      .run();
    return result.meta.changes ?? 0;
  }

  // ----- System Settings -----

  async getSetting(key: string): Promise<SystemSettingRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM system_settings WHERE key = ?')
      .bind(key)
      .first();
    return castFirst<SystemSettingRow>(result);
  }

  async setSetting(key: string, value: string): Promise<void> {
    const now = nowISO();
    const existing = await this.getSetting(key);
    if (existing) {
      await this.db
        .prepare('UPDATE system_settings SET value = ?, updated_at = ? WHERE key = ?')
        .bind(value, now, key)
        .run();
    } else {
      await this.db
        .prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .bind(key, value, now)
        .run();
    }
  }
}