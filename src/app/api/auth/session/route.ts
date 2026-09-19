import { NextRequest, NextResponse } from 'next/server';
import { AuthRepository } from '@/lib/db/auth';
import { validateSession, requireAuthSecrets, parseSessionToken } from '@/lib/auth';

function getRepo(request: NextRequest): AuthRepository {
  const env = (request as any).env;
  if (!env?.DB) {
    throw new Error('Database binding not available');
  }
  return new AuthRepository(env.DB);
}

export async function GET(request: NextRequest) {
  try {
    const repo = getRepo(request);
    const env = (request as any).env;
    const secrets = requireAuthSecrets(env);

    const sessionToken = parseSessionToken(request.headers.get('cookie'));
    if (!sessionToken) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const user = await validateSession(env.DB, secrets, sessionToken);
    if (!user) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('GET /api/auth/session error:', error);
    return NextResponse.json({ authenticated: false }, { status: 500 });
  }
}