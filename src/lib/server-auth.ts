/**
 * Server-side authentication helpers for use in Server Components and API routes.
 * These functions require the Cloudflare D1 database binding.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { AuthRepository } from '@/lib/db/auth';
import { validateSession, requireAuthSecrets, parseSessionToken, UserRow } from '@/lib/auth';
import type { NextRequest } from 'next/server';

export interface AuthContext {
  db: D1Database;
  env: Record<string, unknown>;
  cookies: string | null;
}

/**
 * Gets the authenticated user from the request context.
 * Returns null if not authenticated.
 */
export async function getAuthenticatedUser(context: AuthContext): Promise<UserRow | null> {
  const secrets = requireAuthSecrets(context.env);
  const sessionToken = parseSessionToken(context.cookies);
  if (!sessionToken) return null;

  return validateSession(context.db, secrets, sessionToken);
}

/**
 * Requires authentication - throws if not authenticated.
 * Use in API routes that require auth.
 */
export async function requireAuth(context: AuthContext): Promise<UserRow> {
  const user = await getAuthenticatedUser(context);
  if (!user) {
    const error = new Error('Unauthorized');
    (error as any).status = 401;
    (error as any).code = 'unauthenticated';
    throw error;
  }
  return user;
}

/**
 * Requires admin role - throws if not admin.
 */
export async function requireAdmin(context: AuthContext): Promise<UserRow> {
  const user = await requireAuth(context);
  if (user.role !== 'admin') {
    const error = new Error('Forbidden');
    (error as any).status = 403;
    (error as any).code = 'forbidden';
    throw error;
  }
  return user;
}

/**
 * Creates an auth context from a NextRequest.
 */
export function createAuthContext(request: NextRequest): AuthContext {
  return {
    db: (request as any).env.DB,
    env: request as any,
    cookies: request.headers.get('cookie'),
  };
}

/**
 * Creates an auth context from the worker env (for worker routes).
 */
export function createWorkerAuthContext(env: Record<string, unknown>): AuthContext {
  return {
    db: env.DB as D1Database,
    env,
    cookies: null, // Worker routes use Bearer auth
  };
}