import { NextRequest, NextResponse } from 'next/server';
import { VMRepository } from '@/lib/db/vm';
import { AuthRepository } from '@/lib/db/auth';
import { checkRateLimit, requireAuthSecrets } from '@/lib/auth';
import { requireAuth, createAuthContext } from '@/lib/server-auth';

function getVMRepo(request: NextRequest): VMRepository {
  const env = (request as any).env;
  if (!env?.DB) {
    throw new Error('Database binding not available');
  }
  return new VMRepository(env.DB);
}

function getAuthRepo(request: NextRequest): AuthRepository {
  const env = (request as any).env;
  if (!env?.DB) {
    throw new Error('Database binding not available');
  }
  return new AuthRepository(env.DB);
}

// Rate limit: 5 restarts per hour per VM
const RESTART_RATE_LIMIT = { maxRequests: 5, windowSeconds: 3600 };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(createAuthContext(request));
    const repo = getVMRepo(request);
    const authRepo = getAuthRepo(request);
    const env = (request as any).env;
    const secrets = requireAuthSecrets(env);
    const { id } = await params;

    const vm = await repo.findById(id);
    if (!vm) {
      return NextResponse.json({ error: 'VM not found' }, { status: 404 });
    }

    // Rate limiting
    const rateLimitKey = `restart:${id}`;
    const rateLimit = await checkRateLimit(env.DB, rateLimitKey, RESTART_RATE_LIMIT.maxRequests, RESTART_RATE_LIMIT.windowSeconds);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Maximum 5 restarts per hour.', code: 'rate_limited', resetAt: rateLimit.resetAt },
        { status: 429, headers: { 'Retry-After': String(RESTART_RATE_LIMIT.windowSeconds) } }
      );
    }

    // Create restart command
    const command = await repo.createCommand({ vm_id: id, command: 'restart' });

    // Update VM status to 'starting' to reflect pending restart
    await repo.update(id, { status: 'starting' });

    // Audit log
    await authRepo.getDb()
      .prepare(
        `INSERT INTO audit_logs (id, vm_id, event_type, severity, message, metadata, created_at)
         VALUES (?, ?, 'command_restart', 'info', ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), id, `Restart command issued for "${vm.name}"`, JSON.stringify({ command_id: command.id }), new Date().toISOString())
      .run();

    return NextResponse.json({
      command,
      message: 'Restart command queued. Agent will execute on next poll.',
    });
  } catch (error) {
    const status = (error as any).status || 500;
    if (status === 401) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: 401 });
    }
    console.error('POST /api/vms/[id]/restart error:', error);
    return NextResponse.json({ error: 'Failed to queue restart command' }, { status: 500 });
  }
}