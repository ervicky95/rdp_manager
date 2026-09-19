import { NextRequest, NextResponse } from 'next/server';
import { AuthRepository } from '@/lib/db/auth';
import { verifyPassword, createSession, requireAuthSecrets, buildSessionCookie } from '@/lib/auth';

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

    const body = await request.json();
    const { email, password } = body;

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Find user
    const user = await repo.findUserByEmail(email.toLowerCase().trim());
    if (!user) {
      // Use constant-time comparison to prevent timing attacks
      await verifyPassword(password, '$2b$12$invalid$salt$hash', secrets.passwordSecret);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Verify password
    const valid = await verifyPassword(password, user.password_hash, secrets.passwordSecret);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Create session
    const userAgent = request.headers.get('user-agent');
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                      request.headers.get('x-real-ip') ||
                      null;

    const sessionToken = await createSession(
      env.DB,
      secrets,
      user.id,
      userAgent,
      ipAddress
    );

    // Update last login
    await repo.updateLastLogin(user.id);

    // Build response with session cookie
    const isProduction = env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production';
    const cookie = buildSessionCookie(sessionToken, isProduction);

    return NextResponse.json(
      { success: true, user: { id: user.id, email: user.email, role: user.role } },
      {
        status: 200,
        headers: {
          'Set-Cookie': cookie,
        },
      }
    );
  } catch (error) {
    console.error('POST /api/auth/login error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.includes('is not configured')) {
      return NextResponse.json({ error: message, code: 'server_misconfigured' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}