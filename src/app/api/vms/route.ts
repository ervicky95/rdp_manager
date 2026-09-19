import { env as workerEnv } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { VMRepository } from '@/lib/db/vm';
import { AuthRepository } from '@/lib/db/auth';
import { createEnrollmentToken, requireEnrollmentSecrets } from '@/lib/enrollment';
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
  const repo = new AuthRepository(env.DB);
  return repo;
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth(createAuthContext(request));
    const repo = getVMRepo(request);

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || undefined;
    const status = (searchParams.get('status') as any) || 'all';
    const rdpStatus = (searchParams.get('rdp_status') as any) || 'all';
    const onlineOnly = searchParams.get('online') === 'true';
    const sortBy = (searchParams.get('sort_by') as any) || 'created_at';
    const sortOrder = (searchParams.get('sort_order') as any) || 'desc';
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');

    const vms = await repo.findAllFiltered({
      search,
      status,
      rdpStatus,
      onlineOnly,
      sortBy,
      sortOrder,
      limit,
      offset,
    });

    return NextResponse.json({ vms });
  } catch (error) {
    const status = (error as any).status || 500;
    if (status === 401) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: 401 });
    }
    console.error('GET /api/vms error:', error);
    return NextResponse.json({ error: 'Failed to fetch VMs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAuth(createAuthContext(request));
    const repo = getVMRepo(request);
    const body = await request.json();

    const { name, ip_address, agent_id, agent_version, windows_version } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!ip_address || typeof ip_address !== 'string') {
      return NextResponse.json({ error: 'IP address is required' }, { status: 400 });
    }

    // Validate IP format (basic)
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip_address)) {
      return NextResponse.json({ error: 'Invalid IP address format' }, { status: 400 });
    }

    // Check for duplicate name
    const existing = await repo.findByName(name);
    if (existing) {
      return NextResponse.json({ error: 'VM with this name already exists' }, { status: 409 });
    }

    const vm = await repo.create({
      name: name.trim(),
      ip_address: ip_address.trim(),
      agent_id: agent_id?.trim() || undefined,
      agent_version: agent_version?.trim() || undefined,
      windows_version: windows_version?.trim() || undefined,
    });

    // Creating a VM also creates a single-use, expiring enrollment token so the
    // operator can install the agent. The plaintext token is returned once.
    const env = (workerEnv as any);
    const secrets = requireEnrollmentSecrets(env);
    const token = await createEnrollmentToken(env.DB, vm.id, secrets);

    // Audit log
    const authRepo = getAuthRepo(request);
    await authRepo.getDb()
      .prepare(
        `INSERT INTO audit_logs (id, vm_id, event_type, severity, message, metadata, created_at)
         VALUES (?, ?, 'vm_created', 'info', ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), vm.id, `VM "${vm.name}" created`, JSON.stringify({ ip: vm.ip_address }), new Date().toISOString())
      .run();

    return NextResponse.json(
      { vm, enrollment_token: token.token, expires_at: token.expiresAt },
      { status: 201 }
    );
  } catch (error) {
    const status = (error as any).status || 500;
    if (status === 401) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: 401 });
    }
    console.error('POST /api/vms error:', error);
    return NextResponse.json({ error: 'Failed to create VM' }, { status: 500 });
  }
}