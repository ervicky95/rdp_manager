import type { D1Database, ExecutionContext, Fetcher } from '@cloudflare/workers-types';
import { VMRepository } from '@/lib/db/vm';
import { AgentRepository } from '@/lib/db/agent';
import { generateSecret, generateAgentId, hashSecret, timingSafeEqual } from '@/lib/crypto';
import { createEnrollmentToken, requireEnrollmentSecrets, serverNowIso } from '@/lib/enrollment';
import type { EnrollmentSecrets } from '@/lib/enrollment';
import { nowISO } from '@/lib/db/client';
import { default as vinextHandler } from 'vinext/server/fetch-handler';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ENROLLMENT_TOKEN_SECRET?: string;
  AGENT_CREDENTIAL_SECRET?: string;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv extends Env {}
  }
}

const AGENT_POLL_INTERVAL_SECONDS = 60;

/** Compact event types the server will accept from an agent on poll. */
const ALLOWED_EVENT_TYPES = new Set([
  'heartbeat',
  'command_acknowledged',
  'command_completed',
  'command_failed',
  'status_report',
]);

// Fixed allowlisted Windows commands that agents may execute
const ALLOWED_COMMANDS = new Set(['restart', 'shutdown', 'status', 'rdp_check']);

// Command timeout defaults (seconds)
const COMMAND_TIMEOUTS: Record<string, number> = {
  restart: 300,
  shutdown: 300,
  status: 30,
  rdp_check: 30,
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function errorJson(message: string, code: string, status: number): Response {
  return json({ error: message, code }, status);
}

interface AgentInfo {
  machineId?: string;
  hostname?: string;
  agentVersion?: string;
}

function parseAgentInfo(body: any): AgentInfo {
  if (body === null || typeof body !== 'object') return {};
  const pick = (k: string): string | undefined =>
    typeof body[k] === 'string' ? String(body[k]).slice(0, 255) : undefined;
  return { machineId: pick('machine_id'), hostname: pick('hostname'), agentVersion: pick('agent_version') };
}

/**
 * Authorizes a poll request from the `Authorization: Bearer agentId:credential`
 * header. Returns the matching agent row, or null when unauthenticated.
 */
async function authorizeAgent(db: D1Database, secrets: EnrollmentSecrets, request: Request): Promise<{ agent: any; credential: string } | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+([^:\s]+):(.+)$/.exec(header);
  if (!match) return null;
  const agentId = match[1];
  const credential = match[2];

  const repo = new AgentRepository(db);
  const agent = await repo.findAgentByAgentId(agentId);
  if (!agent) return null;

  const expected = await hashSecret(credential, secrets.agentCredentialSecret, 'agent-credential');
  if (!timingSafeEqual(expected, agent.credential_hash)) return null;
  return { agent, credential };
}

/**
 * Applied against D1's `commands` table for events a registered agent reports.
 * Ownership is always scoped to the agent's own VM so one VM cannot mutate
 * another VM's command state.
 */
async function applyCompactEvents(db: D1Database, vmId: string, agentId: string, events: any[]): Promise<void> {
  const repo = new AgentRepository(db);
  const vmRepo = new VMRepository(db);

  for (const ev of events) {
    if (ev === null || typeof ev !== 'object') continue;
    const type = ev.type;
    if (typeof type !== 'string' || !ALLOWED_EVENT_TYPES.has(type)) continue;

    switch (type) {
      case 'heartbeat':
        // Presence is tracked via last_seen_at on poll; nothing else to store.
        break;
      case 'command_acknowledged': {
        const commandId = typeof ev.command_id === 'string' ? ev.command_id : null;
        if (!commandId) break;
        const command = await vmRepo.getCommandById(commandId);
        if (!command || command.vm_id !== vmId) break; // ownership guard
        // Only transition pending -> executing on first acknowledgment
        if (command.status === 'pending') {
          await vmRepo.acknowledgeCommand(commandId);
        }
        break;
      }
      case 'command_completed':
      case 'command_failed': {
        const commandId = typeof ev.command_id === 'string' ? ev.command_id : null;
        if (!commandId) break;
        const command = await vmRepo.getCommandById(commandId);
        if (!command || command.vm_id !== vmId) break; // ownership guard
        const status = type === 'command_completed' ? 'completed' : 'failed';
        const result = typeof ev.result === 'string' ? ev.result.slice(0, 2000) : undefined;
        const executedAt = nowISO();
        await vmRepo.updateCommandStatus(commandId, status, executedAt, result);

        // Audit log for command completion/failure
        const eventType = command.command === 'restart' ? 'command_restart'
          : command.command === 'shutdown' ? 'command_shutdown'
          : command.command === 'status' ? 'command_status'
          : command.command === 'rdp_check' ? 'command_rdp_check'
          : 'command_completed';
        await vmRepo.createAuditLog({
          vm_id: vmId,
          event_type: status === 'completed' ? eventType : 'command_failed',
          severity: status === 'completed' ? 'info' : 'error',
          message: `Command ${command.command} ${status}`,
          metadata: { command_id: commandId, result },
        });
        break;
      }
      case 'status_report': {
        // Agent reports fresh system status (CPU, RAM, disk, uptime, RDP)
        const cpu = typeof ev.cpu_percent === 'number' ? Math.max(0, Math.min(100, ev.cpu_percent)) : null;
        const ram = typeof ev.ram_percent === 'number' ? Math.max(0, Math.min(100, ev.ram_percent)) : null;
        const disk = typeof ev.disk_percent === 'number' ? Math.max(0, Math.min(100, ev.disk_percent)) : null;
        const windowsVersion = typeof ev.windows_version === 'string' ? ev.windows_version.slice(0, 100) : null;
        const agentVersion = typeof ev.agent_version === 'string' ? ev.agent_version.slice(0, 50) : null;
        const uptime = typeof ev.uptime_seconds === 'number' && ev.uptime_seconds >= 0 ? ev.uptime_seconds : null;
        const rdpStatus = typeof ev.rdp_status === 'string' &&
          ['healthy', 'degraded', 'unknown', 'unreachable'].includes(ev.rdp_status)
          ? ev.rdp_status : 'unknown';
        const timestamp = typeof ev.timestamp === 'string' ? ev.timestamp : nowISO();

        if (cpu !== null && ram !== null && disk !== null && uptime !== null) {
          await vmRepo.createAgentStatusReport({
            vm_id: vmId,
            agent_id: agentId,
            cpu_percent: cpu,
            ram_percent: ram,
            disk_percent: disk,
            windows_version: windowsVersion,
            agent_version: agentVersion,
            uptime_seconds: uptime,
            rdp_status: rdpStatus,
            timestamp,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  // Expire pending commands that have passed their expiration time
  await vmRepo.expireCommands(vmId);
  // Opportunistic cleanup; the strict expiry check below is authoritative.
  await repo.deleteExpiredEnrollmentTokens(nowISO());
}

async function handleEnroll(db: D1Database, secrets: EnrollmentSecrets, request: Request): Promise<Response> {
  const token = (request.headers.get('x-vickyvm-enrollment-token') ?? '').trim();
  if (!token) {
    return errorJson('Missing enrollment token', 'invalid_token', 401);
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const info = parseAgentInfo(body);

  const repo = new AgentRepository(db);
  const tokenHash = await hashSecret(token, secrets.enrollmentTokenSecret, 'enrollment-token');
  const row = await repo.findEnrollmentTokenByHash(tokenHash);

  if (!row) {
    return errorJson('Invalid enrollment token', 'invalid_token', 401);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await repo.consumeEnrollmentToken(row.id); // single-use: do not accept an expired token twice
    return errorJson('Enrollment token expired', 'token_expired', 401);
  }

  // Re-enrollment rotates the previous credential (immediately revokes it).
  await repo.deleteAgentByVmId(row.vm_id);

  const agentId = generateAgentId();
  const credential = generateSecret(32);
  const credentialHash = await hashSecret(credential, secrets.agentCredentialSecret, 'agent-credential');

  await repo.createAgent({
    vm_id: row.vm_id,
    agent_id: agentId,
    credential_hash: credentialHash,
    machine_id: info.machineId,
    hostname: info.hostname,
    agent_version: info.agentVersion,
  });

  // Single-use: consuming the token after successful enrollment.
  await repo.consumeEnrollmentToken(row.id);

  // The credential is returned exactly once, to this agent, and is never
  // persisted, logged, or returned to any other caller.
  return json({
    agent_id: agentId,
    credential,
    poll_interval_seconds: AGENT_POLL_INTERVAL_SECONDS,
    server_time: serverNowIso(),
  });
}

async function handlePoll(db: D1Database, secrets: EnrollmentSecrets, request: Request): Promise<Response> {
  const auth = await authorizeAgent(db, secrets, request);
  if (!auth) {
    return errorJson('Unauthorized', 'unauthorized', 401);
  }
  const { agent, credential } = auth;

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  await new AgentRepository(db).touchAgent(agent.agent_id, {
    lastSeenAt: nowISO(),
    agentVersion: parseAgentInfo(body).agentVersion,
  });

  const events = Array.isArray(body.events) ? body.events : [];
  await applyCompactEvents(db, agent.vm_id, agent.agent_id, events);

  const vm = new VMRepository(db);
  const settings = await vm.getSettings(agent.vm_id);

  // Filter commands based on settings
  const commands = await vm.getPendingCommands(agent.vm_id);
  const filteredCommands = commands.filter(cmd => {
    if (settings?.safe_maintenance_mode && (cmd.command === 'restart' || cmd.command === 'shutdown')) {
      return false; // Block restart/shutdown in safe maintenance mode
    }
    if (cmd.command === 'rdp_check' && !settings?.rdp_check_enabled) {
      return false; // Block RDP checks if disabled
    }
    return true;
  });

  return json({
    commands: filteredCommands,
    events: [],
    poll_interval_seconds: AGENT_POLL_INTERVAL_SECONDS,
    server_time: serverNowIso(),
  });
}

async function handleCreateVm(db: D1Database, secrets: EnrollmentSecrets, request: Request): Promise<Response> {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return errorJson('Invalid JSON body', 'bad_request', 400);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const ipAddress = typeof body.ip_address === 'string' ? body.ip_address.trim() : '';
  if (!name) return errorJson('Name is required', 'bad_request', 400);
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ipAddress)) return errorJson('Invalid IP address format', 'bad_request', 400);

  const vmRepo = new VMRepository(db);
  if (await vmRepo.findByName(name)) {
    return errorJson('VM with this name already exists', 'conflict', 409);
  }

  const vm = await vmRepo.create({
    name,
    ip_address: ipAddress,
    agent_version: typeof body.agent_version === 'string' ? body.agent_version.trim() || undefined : undefined,
    windows_version: typeof body.windows_version === 'string' ? body.windows_version.trim() || undefined : undefined,
  });

  const created = await createEnrollmentToken(db, vm.id, secrets);
  return json({
    vm,
    enrollment_token: created.token,
    expires_at: created.expiresAt,
  }, 201);
}

async function handleCreateVmToken(db: D1Database, secrets: EnrollmentSecrets, vmId: string): Promise<Response> {
  const vmRepo = new VMRepository(db);
  const vm = await vmRepo.findById(vmId);
  if (!vm) return errorJson('VM not found', 'not_found', 404);

  const created = await createEnrollmentToken(db, vmId, secrets);
  return json({
    vm_id: vmId,
    enrollment_token: created.token,
    expires_at: created.expiresAt,
  }, 201);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;
    const pathname = url.pathname;

    try {
      if (method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
        return json({ ok: true });
      }

      if (method === 'POST') {
        if (pathname === '/api/vms') {
          return await handleCreateVm(env.DB, requireEnrollmentSecrets(env as any), request);
        }
        const tokenRoute = /^\/api\/vms\/([^/]+)\/enrollment-token$/.exec(pathname);
        if (tokenRoute) {
          return await handleCreateVmToken(env.DB, requireEnrollmentSecrets(env as any), decodeURIComponent(tokenRoute[1]));
        }
        if (pathname === '/api/agent/enroll') {
          return await handleEnroll(env.DB, requireEnrollmentSecrets(env as any), request);
        }
        if (pathname === '/api/agent/poll') {
          return await handlePoll(env.DB, requireEnrollmentSecrets(env as any), request);
        }
      }

      // Delegate all other routes to the Vinext/App Router handler.
      // This handles page routes (/, /login, /dashboard, /vms/[id]) and Next.js API routes.
      return await vinextHandler(request, env, ctx);
    } catch (error) {
      // Do not log request bodies or credentials; log only the error type.
      const message = error instanceof Error ? error.message : 'Internal error';
      if (message.includes('is not configured')) {
        return errorJson(message, 'server_misconfigured', 500);
      }
      console.error('worker error:', message);
      return errorJson('Internal server error', 'internal', 500);
    }
  },
} as const;
