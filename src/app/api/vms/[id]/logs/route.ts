import { NextRequest, NextResponse } from 'next/server';
import { VMRepository } from '@/lib/db/vm';
import { requireAuth, createAuthContext } from '@/lib/server-auth';

function getVMRepo(request: NextRequest): VMRepository {
  const env = (request as any).env;
  if (!env?.DB) {
    throw new Error('Database binding not available');
  }
  return new VMRepository(env.DB);
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

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');
    const level = searchParams.get('level') || undefined;

    const logs = await repo.getLogs(id, limit, offset);
    // Filter by level if specified
    const filteredLogs = level ? logs.filter(log => log.level === level) : logs;

    return NextResponse.json({ logs: filteredLogs });
  } catch (error) {
    const status = (error as any).status || 500;
    if (status === 401) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: 401 });
    }
    console.error('GET /api/vms/[id]/logs error:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}