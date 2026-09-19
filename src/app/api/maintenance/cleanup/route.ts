import { NextRequest, NextResponse } from 'next/server';
import { VMRepository } from '@/lib/db/vm';
import { AuthRepository } from '@/lib/db/auth';
import { cleanupExpiredSessions, cleanupRateLimits, requireAuthSecrets } from '@/lib/auth';
import { requireAdmin, createAuthContext } from '@/lib/server-auth';

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

// This endpoint can be called by a cron job or manually by admin
// Retention: 30 days for logs, audit logs, and agent status reports
const RETENTION_DAYS = 30;

export async function POST(request: NextRequest) {
  try {
    // Allow cron jobs with a secret or admin auth
    const authHeader = request.headers.get('authorization');
    const cronSecret = (request as any).env.CRON_SECRET;

    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      // Valid cron secret, proceed
    } else {
      // Require admin authentication
      await requireAdmin(createAuthContext(request));
    }

    const repo = getVMRepo(request);
    const authRepo = getAuthRepo(request);
    const env = (request as any).env;
    const secrets = requireAuthSecrets(env);

    const results = {
      logsDeleted: 0,
      auditLogsDeleted: 0,
      statusReportsDeleted: 0,
      sessionsDeleted: 0,
      rateLimitsDeleted: 0,
    };

    // Clean up old logs (30-day retention)
    results.logsDeleted = await repo.deleteOldLogs(RETENTION_DAYS);
    results.auditLogsDeleted = await repo.deleteOldAuditLogs(RETENTION_DAYS);
    results.statusReportsDeleted = await repo.deleteOldAgentStatusReports(RETENTION_DAYS);

    // Clean up expired sessions
    results.sessionsDeleted = await cleanupExpiredSessions(env.DB);

    // Clean up old rate limits
    results.rateLimitsDeleted = await cleanupRateLimits(env.DB);

    return NextResponse.json({
      success: true,
      message: `Cleanup completed. Deleted: ${results.logsDeleted} logs, ${results.auditLogsDeleted} audit logs, ${results.statusReportsDeleted} status reports, ${results.sessionsDeleted} sessions, ${results.rateLimitsDeleted} rate limits.`,
      details: results,
    });
  } catch (error) {
    const status = (error as any).status || 500;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: status });
    }
    console.error('POST /api/maintenance/cleanup error:', error);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}