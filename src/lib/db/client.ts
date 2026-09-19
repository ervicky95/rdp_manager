import type { D1Database } from '@cloudflare/workers-types';

export function createDB(env: { DB: D1Database }): D1Database {
  return env.DB;
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}