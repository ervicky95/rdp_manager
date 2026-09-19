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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(createAuthContext(request));
    const repo = getVMRepo(request);
    const { id } = await params;

    const vm = await repo.findById(id);
    if (!vm) {
      return NextResponse.json({ error: 'VM not found' }, { status: 404 });
    }

    const settings = await repo.getSettings(id);
    return NextResponse.json({ vm, settings });
  } catch (error) {
    const status = (error as any).status || 500;
    if (status === 401) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: 401 });
    }
    console.error('GET /api/vms/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch VM' }, { status: 500 });
  }
}

export async function DELETE(
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

    // DELETE only removes the web-app record (cascades to settings, logs, commands)
    // It does NOT contact the VM or affect Azure
    const deleted = await repo.delete(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete VM' }, { status: 500 });
    }

    // Audit log
    await authRepo.getDb()
      .prepare(
        `INSERT INTO audit_logs (id, vm_id, event_type, severity, message, metadata, created_at)
         VALUES (?, ?, 'vm_deleted', 'warn', ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), id, `VM "${vm.name}" deleted from dashboard`, JSON.stringify({ name: vm.name }), new Date().toISOString())
      .run();

    return NextResponse.json({ success: true, message: 'VM record deleted from web app' });
  } catch (error) {
    const status = (error as any).status || 500;
    if (status === 401) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: 401 });
    }
    console.error('DELETE /api/vms/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete VM' }, { status: 500 });
  }
}