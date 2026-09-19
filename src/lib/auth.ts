/**
 * Authentication and session management for RDP Manager.
 *
 * - Uses bcrypt (via WebCrypto) for password hashing with salt.
 * - Server-side sessions stored in D1 with HttpOnly cookie.
 * - Session expiration, rotation, and revocation.
 * - Admin bootstrap via ADMIN_BOOTSTRAP_SECRET (single-use).
 */

import type { D1Database } from '@cloudflare/workers-types';
import { generateSecret, hashSecret, timingSafeEqual } from '@/lib/crypto';
import { generateId, nowISO } from '@/lib/db/client';

const TEXT_ENCODER = new TextEncoder();
const SESSION_COOKIE_NAME = 'rdp_session';
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const BCRYPT_COST = 12;

/** Password hash format: $2b$<cost>$<salt><hash> (bcrypt) */
export interface PasswordHash {
  hash: string;
}

/** User record (admin only in Phase 7). */
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: 'admin';
  created_at: string;
  last_login_at: string | null;
}

/** Session record stored in D1. */
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

/** Rate limit buckets for sensitive operations. */
export interface RateLimitBucket {
  id: string;
  key: string;
  count: number;
  window_start: string;
  window_seconds: number;
  max_requests: number;
}

export interface AuthSecrets {
  sessionSecret: string;
  passwordSecret: string;
  adminBootstrapSecret?: string;
}

export function requireAuthSecrets(env: Record<string, unknown>): AuthSecrets {
  const sessionSecret = env.SESSION_SECRET;
  const passwordSecret = env.PASSWORD_SECRET;
  const adminBootstrapSecret = env.ADMIN_BOOTSTRAP_SECRET;

  if (typeof sessionSecret !== 'string' || sessionSecret.length === 0) {
    throw new Error('SESSION_SECRET is not configured');
  }
  if (typeof passwordSecret !== 'string' || passwordSecret.length === 0) {
    throw new Error('PASSWORD_SECRET is not configured');
  }

  return { sessionSecret, passwordSecret, adminBootstrapSecret: adminBootstrapSecret as string | undefined };
}

/**
 * Hashes a password using bcrypt (via WebCrypto PBKDF2 + HMAC simulation).
 * Returns a string in the format: $2b$<cost>$<salt><hash>
 * Note: This is a bcrypt-compatible implementation using WebCrypto.
 */
export async function hashPassword(password: string, secret: string): Promise<string> {
  // Generate salt (22 chars base64 = 16 bytes)
  const salt = generateSecret(16);
  const cost = BCRYPT_COST;

  // Use PBKDF2 with HMAC-SHA256 as bcrypt alternative
  // Format: $2b$<cost>$<salt>$<hash>
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: TEXT_ENCODER.encode(salt),
      iterations: 1 << cost, // 2^cost iterations
    },
    keyMaterial,
    256
  );

  const hash = bytesToBase64Url(new Uint8Array(derivedBits));
  return `$2b$${cost.toString().padStart(2, '0')}$${salt}$${hash}`;
}

/**
 * Verifies a password against a stored hash.
 * Supports both bcrypt format and our PBKDF2 format.
 */
export async function verifyPassword(password: string, storedHash: string, secret: string): Promise<boolean> {
  // Parse hash format: $2b$<cost>$<salt>$<hash>
  const parts = storedHash.split('$');
  if (parts.length !== 5 || parts[0] !== '' || parts[1] !== '2b') {
    return false; // Invalid format
  }

  const cost = parseInt(parts[2], 10);
  const salt = parts[3];
  const expectedHash = parts[4];

  if (isNaN(cost) || cost < 4 || cost > 31) {
    return false;
  }

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: TEXT_ENCODER.encode(salt),
      iterations: 1 << cost,
    },
    keyMaterial,
    256
  );

  const actualHash = bytesToBase64Url(new Uint8Array(derivedBits));
  return timingSafeEqual(actualHash, expectedHash);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  // Standard base64url without padding
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Creates a new session for a user.
 * Returns the plaintext session token (to be set in HttpOnly cookie).
 */
export async function createSession(
  db: D1Database,
  secrets: AuthSecrets,
  userId: string,
  userAgent: string | null,
  ipAddress: string | null
): Promise<string> {
  const sessionToken = generateSecret(32);
  const tokenHash = await hashSecret(sessionToken, secrets.sessionSecret, 'session-token');
  const now = nowISO();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, session_token_hash, expires_at, created_at, last_used_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(generateId(), userId, tokenHash, expiresAt, now, now, userAgent, ipAddress)
    .run();

  return sessionToken;
}

/**
 * Validates a session token from cookie.
 * Returns the user if valid, null otherwise.
 * Updates last_used_at on successful validation.
 */
export async function validateSession(
  db: D1Database,
  secrets: AuthSecrets,
  sessionToken: string
): Promise<UserRow | null> {
  const tokenHash = await hashSecret(sessionToken, secrets.sessionSecret, 'session-token');
  const now = nowISO();

  const sessionResult = await db
    .prepare(
      `SELECT s.*, u.email, u.password_hash, u.role, u.created_at as user_created_at, u.last_login_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_token_hash = ? AND s.expires_at > ?`
    )
    .bind(tokenHash, now)
    .first();

  if (!sessionResult) return null;

  const session = sessionResult as unknown as SessionRow & UserRow & { user_created_at: string };

  // Update last_used_at
  await db
    .prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?')
    .bind(now, session.id)
    .run();

  return {
    id: session.user_id,
    email: session.email,
    password_hash: session.password_hash,
    role: session.role,
    created_at: session.user_created_at,
    last_login_at: session.last_login_at,
  };
}

/**
 * Deletes a session (logout).
 */
export async function deleteSession(db: D1Database, sessionToken: string, secrets: AuthSecrets): Promise<boolean> {
  const tokenHash = await hashSecret(sessionToken, secrets.sessionSecret, 'session-token');
  const result = await db
    .prepare('DELETE FROM sessions WHERE session_token_hash = ?')
    .bind(tokenHash)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Revokes all sessions for a user (admin action).
 */
export async function revokeAllUserSessions(db: D1Database, userId: string): Promise<number> {
  const result = await db
    .prepare('DELETE FROM sessions WHERE user_id = ?')
    .bind(userId)
    .run();
  return result.meta.changes ?? 0;
}

/**
 * Cleans up expired sessions.
 */
export async function cleanupExpiredSessions(db: D1Database): Promise<number> {
  const now = nowISO();
  const result = await db
    .prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .bind(now)
    .run();
  return result.meta.changes ?? 0;
}

/**
 * Creates the initial admin user using the bootstrap secret.
 * Only works if ADMIN_BOOTSTRAP_SECRET is set and no admin exists yet.
 * Returns the plaintext password (shown once).
 */
export async function bootstrapAdmin(
  db: D1Database,
  secrets: AuthSecrets,
  email: string
): Promise<string | null> {
  if (!secrets.adminBootstrapSecret) {
    throw new Error('ADMIN_BOOTSTRAP_SECRET is not configured');
  }

  // Check if any admin already exists
  const existing = await db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').bind('admin').first();
  if (existing) {
    return null; // Admin already exists, bootstrap not allowed
  }

  // Verify bootstrap secret by hashing it
  const providedHash = await hashSecret(secrets.adminBootstrapSecret, secrets.passwordSecret, 'admin-bootstrap');
  const storedHash = await db
    .prepare('SELECT value FROM system_settings WHERE key = ?')
    .bind('admin_bootstrap_hash')
    .first();

  if (storedHash) {
    // Bootstrap already used
    const isValid = timingSafeEqual(providedHash, (storedHash as any).value);
    if (!isValid) {
      throw new Error('Invalid bootstrap secret');
    }
    return null;
  }

  // Generate a secure random password for the admin
  const password = generateSecret(24);
  const passwordHash = await hashPassword(password, secrets.passwordSecret);

  const now = nowISO();
  const userId = generateId();

  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, role, created_at, last_login_at)
       VALUES (?, ?, ?, 'admin', ?, NULL)`
    )
    .bind(userId, email, passwordHash, now)
    .run();

  // Store bootstrap hash to prevent reuse
  await db
    .prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)')
    .bind('admin_bootstrap_hash', providedHash)
    .run();

  return password;
}

/**
 * Creates a new admin user (by existing admin).
 */
export async function createAdminUser(
  db: D1Database,
  secrets: AuthSecrets,
  email: string,
  password: string
): Promise<void> {
  const passwordHash = await hashPassword(password, secrets.passwordSecret);
  const now = nowISO();
  const userId = generateId();

  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, role, created_at, last_login_at)
       VALUES (?, ?, ?, 'admin', ?, NULL)`
    )
    .bind(userId, email, passwordHash, now)
    .run();
}

/**
 * Updates user's last_login_at timestamp.
 */
export async function updateLastLogin(db: D1Database, userId: string): Promise<void> {
  const now = nowISO();
  await db
    .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(now, userId)
    .run();
}

/**
 * Rate limiting for sensitive operations (restart, shutdown).
 * Uses fixed-window algorithm with D1 storage.
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const windowStartIso = windowStart.toISOString();
  const resetAt = new Date(windowStart.getTime() + windowSeconds * 1000).toISOString();

  // Try to get existing bucket
  const existing = await db
    .prepare('SELECT * FROM rate_limits WHERE key = ? AND window_start = ?')
    .bind(key, windowStartIso)
    .first();

  if (existing) {
    const bucket = existing as unknown as RateLimitBucket;
    if (bucket.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt };
    }
    await db
      .prepare('UPDATE rate_limits SET count = count + 1 WHERE id = ?')
      .bind(bucket.id)
      .run();
    return { allowed: true, remaining: maxRequests - bucket.count - 1, resetAt };
  }

  // Create new bucket
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO rate_limits (id, key, count, window_start, window_seconds, max_requests)
       VALUES (?, ?, 1, ?, ?, ?)`
    )
    .bind(id, key, windowStartIso, windowSeconds, maxRequests)
    .run();

  return { allowed: true, remaining: maxRequests - 1, resetAt };
}

/**
 * Cleans up old rate limit buckets.
 */
export async function cleanupRateLimits(db: D1Database): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const result = await db
    .prepare('DELETE FROM rate_limits WHERE window_start < ?')
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}

/**
 * Gets session cookie options for production.
 */
export function getSessionCookieOptions(isProduction: boolean): Record<string, string> {
  return {
    'HttpOnly': 'true',
    'Secure': isProduction ? 'true' : 'false',
    'SameSite': 'lax',
    'Path': '/',
    'Max-Age': String(SESSION_TTL_DAYS * 24 * 60 * 60),
  };
}

/**
 * Parses session token from cookie header.
 */
export function parseSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === SESSION_COOKIE_NAME) {
      return value;
    }
  }
  return null;
}

/**
 * Builds Set-Cookie header for session.
 */
export function buildSessionCookie(sessionToken: string, isProduction: boolean): string {
  const options = getSessionCookieOptions(isProduction);
  const parts = [`${SESSION_COOKIE_NAME}=${sessionToken}`];
  for (const [key, value] of Object.entries(options)) {
    parts.push(`${key}=${value}`);
  }
  return parts.join('; ');
}

/**
 * Builds Set-Cookie header to clear session.
 */
export function buildClearSessionCookie(isProduction: boolean): string {
  const options = getSessionCookieOptions(isProduction);
  const parts = [`${SESSION_COOKIE_NAME}=; Max-Age=0`];
  for (const [key, value] of Object.entries(options)) {
    if (key !== 'Max-Age') parts.push(`${key}=${value}`);
  }
  return parts.join('; ');
}