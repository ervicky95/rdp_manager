import { env as workerEnv } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { VMRepository } from '@/lib/db/vm';
import { AuthRepository } from '@/lib/db/auth';
import { requireAuth, createAuthContext } from '@/lib/server-auth';

function getVMRepo(request: NextRequest): VMRepository {
  const env = (workerEnv as any);
  if (!env?.DB) {
    throw new Error('Database binding not available');
  }
  return new VMRepository(env.DB);
}

function getAuthRepo(request: NextRequest): AuthRepository {
  const env = (workerEnv as any);
  if (!env?.DB) {
    throw new Error('Database binding not available');
  }
  return new AuthRepository(env.DB);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(createAuthContext(request));
    const repo = getVMRepo(request);
    const authRepo = getAuthRepo(request);
    const { id } = await params;

    const vm = await repo.findById(id);
    if (!vm) {
      return NextResponse.json({ error: 'VM not found' }, { status: 404 });
    }

    // Only create a pending command in D1
    // Does NOT call Azure or the VM directly
    const command = await repo.createCommand({
      vm_id: id,
      command: 'status',
    });

    // Audit log
    await authRepo.getDb()
      .prepare(
        `INSERT INTO audit_logs (id, vm_id, event_type, severity, message, metadata, created_at)
         VALUES (?, ?, 'command_status', 'info', ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), id, `Status check command queued for "${vm.name}"`, JSON.stringify({ command_id: command.id }), new Date().toISOString())
      .run();

    return NextResponse.json({
      command,
      message: 'Status check command queued. Agent will execute on next poll.',
    });
  } catch (error) {
    const status = (error as any).status || 500;
    if (status === 401) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: 401 });
    }
    console.error('POST /api/vms/[id]/status error:', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    if (message.includes('Invalid command')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to queue status command' }, { status: 500 });
  }
}