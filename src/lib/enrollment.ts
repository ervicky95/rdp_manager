import type { D1Database } from '@cloudflare/workers-types';
import { AgentRepository } from '@/lib/db/agent';
import { generateSecret, hashSecret } from '@/lib/crypto';
import { nowISO } from '@/lib/db/client';

/** Enrollment tokens expire after 30 minutes. */
export const ENROLLMENT_TOKEN_TTL_MINUTES = 30;

export interface EnrollmentSecrets {
  /** HMAC key for enrollment token digests. */
  enrollmentTokenSecret: string;
  /** HMAC key for agent credential digests. */
  agentCredentialSecret: string;
}

/**
 * Reads the two required secrets from the environment. Throws if either is
 * missing so the caller can fail closed (a server without these keys cannot
 * safely issue or verify tokens).
 */
export function requireEnrollmentSecrets(env: Record<string, unknown>): EnrollmentSecrets {
  const enrollmentTokenSecret = env.ENROLLMENT_TOKEN_SECRET;
  const agentCredentialSecret = env.AGENT_CREDENTIAL_SECRET;
  if (typeof enrollmentTokenSecret !== 'string' || enrollmentTokenSecret.length === 0) {
    throw new Error('ENROLLMENT_TOKEN_SECRET is not configured');
  }
  if (typeof agentCredentialSecret !== 'string' || agentCredentialSecret.length === 0) {
    throw new Error('AGENT_CREDENTIAL_SECRET is not configured');
  }
  return { enrollmentTokenSecret, agentCredentialSecret };
}

export interface CreatedToken {
  /** Plaintext token. Returned to the caller exactly once; never persisted. */
  token: string;
  /** ISO timestamp when the token expires. */
  expiresAt: string;
}

/**
 * Creates a single-use, expiring enrollment token for a VM. Only the
 * HMAC-SHA256 digest is stored (under the enrollment secret).
 */
export async function createEnrollmentToken(
  db: D1Database,
  vmId: string,
  secrets: EnrollmentSecrets,
  ttlMinutes = ENROLLMENT_TOKEN_TTL_MINUTES
): Promise<CreatedToken> {
  const token = generateSecret(32);
  const tokenHash = await hashSecret(token, secrets.enrollmentTokenSecret, 'enrollment-token');
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  await new AgentRepository(db).createEnrollmentToken({ vmId, tokenHash, expiresAt });
  return { token, expiresAt };
}

/** Current UTC time as an ISO string (kept in sync with the DB layer). */
export function serverNowIso(): string {
  return nowISO();
}
