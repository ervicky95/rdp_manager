import { getRequestEnv } from '@/lib/request-env';
import { NextRequest, NextResponse } from 'next/server';
import { VMRepository } from '@/lib/db/vm';
import { AuthRepository } from '@/lib/db/auth';
import { createEnrollmentToken, requireEnrollmentSecrets } from '@/lib/enrollment';
import { requireAuth, createAuthContext } from '@/lib/server-auth';

function getVMRepo(request: NextRequest): VMRepository {
  const env = (getRequestEnv() as any);
  if (!env?.DB) {
    throw new Error('Database binding not available');
  }
  return new VMRepository(env.DB);
}

function getAuthRepo(request: NextRequest): AuthRepository {
  const env = (getRequestEnv() as any);
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
    const env = (getRequestEnv() as any);
    const secrets = requireEnrollmentSecrets(env);
    const { id } = await params;

    const vm = await repo.findById(id);
    if (!vm) {
      return NextResponse.json({ error: 'VM not found' }, { status: 404 });
    }

    const created = await createEnrollmentToken(env.DB, id, secrets);

    // Audit log
    await authRepo.getDb()
      .prepare(
        `INSERT INTO audit_logs (id, vm_id, event_type, severity, message, metadata, created_at)
         VALUES (?, ?, 'enrollment_token_created', 'info', ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), id, `Enrollment token created for "${vm.name}"`, JSON.stringify({ expires_at: created.expiresAt }), new Date().toISOString())
      .run();

    return NextResponse.json(
      { enrollment_token: created.token, expires_at: created.expiresAt },
      { status: 201 }
    );
  } catch (error) {
    const status = (error as any).status || 500;
    if (status === 401) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: 401 });
    }
    console.error('POST /api/vms/[id]/enrollment-token error:', error);
    return NextResponse.json({ error: 'Failed to create enrollment token' }, { status: 500 });
  }
}