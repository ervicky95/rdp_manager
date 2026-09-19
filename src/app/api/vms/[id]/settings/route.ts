import { NextRequest, NextResponse } from 'next/server';
import { VMRepository } from '@/lib/db/vm';
import { AuthRepository } from '@/lib/db/auth';
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
    if (!settings) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 });
    }

    return NextResponse.json({ settings });
  } catch (error) {
    const status = (error as any).status || 500;
    if (status === 401) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: 401 });
    }
    console.error('GET /api/vms/[id]/settings error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(
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

    const body = await request.json();

    const allowedFields = [
      'monitoring_enabled',
      'auto_rdp_recovery',
      'cpu_warning',
      'cpu_critical',
      'ram_warning',
      'ram_critical',
      'disk_warning',
      'disk_critical',
      'rdp_check_enabled',
      'rdp_check_interval_minutes',
      'safe_maintenance_mode',
    ];

    const updates: Record<string, boolean | number> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        const value = body[field];
        if (typeof value === 'boolean') {
          updates[field] = value;
        } else if (typeof value === 'number') {
          if (field === 'rdp_check_interval_minutes') {
            if (value >= 1 && value <= 60) {
              updates[field] = value;
            } else {
              return NextResponse.json({ error: 'rdp_check_interval_minutes must be between 1 and 60' }, { status: 400 });
            }
          } else if (value >= 0 && value <= 100) {
            updates[field] = value;
          } else {
            return NextResponse.json({ error: `Invalid value for ${field}` }, { status: 400 });
          }
        } else {
          return NextResponse.json({ error: `Invalid value for ${field}` }, { status: 400 });
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Validate warning < critical
    if (updates.cpu_warning !== undefined && updates.cpu_critical !== undefined) {
      if (updates.cpu_warning >= updates.cpu_critical) {
        return NextResponse.json({ error: 'cpu_warning must be less than cpu_critical' }, { status: 400 });
      }
    }
    if (updates.ram_warning !== undefined && updates.ram_critical !== undefined) {
      if (updates.ram_warning >= updates.ram_critical) {
        return NextResponse.json({ error: 'ram_warning must be less than ram_critical' }, { status: 400 });
      }
    }
    if (updates.disk_warning !== undefined && updates.disk_critical !== undefined) {
      if (updates.disk_warning >= updates.disk_critical) {
        return NextResponse.json({ error: 'disk_warning must be less than disk_critical' }, { status: 400 });
      }
    }

    const settings = await repo.updateSettings(id, updates);

    // Audit log
    await authRepo.getDb()
      .prepare(
        `INSERT INTO audit_logs (id, vm_id, event_type, severity, message, metadata, created_at)
         VALUES (?, ?, 'settings_updated', 'info', ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), id, `Settings updated for "${vm.name}"`, JSON.stringify(updates), new Date().toISOString())
      .run();

    return NextResponse.json({ settings });
  } catch (error) {
    const status = (error as any).status || 500;
    if (status === 401) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: 401 });
    }
    console.error('PUT /api/vms/[id]/settings error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}