import { NextRequest, NextResponse } from 'next/server';
import { AuthRepository } from '@/lib/db/auth';
import { deleteSession, requireAuthSecrets, buildClearSessionCookie, parseSessionToken } from '@/lib/auth';

function getRepo(request: NextRequest): AuthRepository {
  const env = (request as any).env;
  if (!env?.DB) {
    throw new Error('Database binding not available');
  }
  return new AuthRepository(env.DB);
}

export async function POST(request: NextRequest) {
  try {
    const repo = getRepo(request);
    const env = (request as any).env;
    const secrets = requireAuthSecrets(env);

    const sessionToken = parseSessionToken(request.headers.get('cookie'));
    if (sessionToken) {
      await deleteSession(env.DB, sessionToken, secrets);
    }

    const isProduction = env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production';
    const cookie = buildClearSessionCookie(isProduction);

    return NextResponse.json(
      { success: true },
      {
        status: 200,
        headers: {
          'Set-Cookie': cookie,
        },
      }
    );
  } catch (error) {
    console.error('POST /api/auth/logout error:', error);
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}