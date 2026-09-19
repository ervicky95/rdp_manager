import { getRequestEnv } from '@/lib/request-env';
import { NextRequest, NextResponse } from 'next/server';
import { bootstrapAdmin, requireAuthSecrets } from '@/lib/auth';

type BootstrapBody = {
  email?: unknown;
  bootstrapSecret?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const env = getRequestEnv() as any;
    const secrets = requireAuthSecrets(env);

    let body: BootstrapBody;

    try {
      body = (await request.json()) as BootstrapBody;
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON request' },
        { status: 400 }
      );
    }

    const email =
      typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : '';

    const bootstrapSecret =
      typeof body.bootstrapSecret === 'string'
        ? body.bootstrapSecret
        : '';

    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400 }
      );
    }

    if (!bootstrapSecret || bootstrapSecret.length > 256) {
      return NextResponse.json(
        { error: 'Bootstrap secret is required' },
        { status: 400 }
      );
    }

    const password = await bootstrapAdmin(
      env.DB,
      secrets,
      email,
      bootstrapSecret
    );

    if (password === null) {
      return NextResponse.json(
        { error: 'Administrator setup has already been completed' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        email,
        password,
        message:
          'Administrator created. Save this password now; it will not be shown again.',
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';

    if (message === 'Invalid bootstrap secret') {
      return NextResponse.json(
        { error: 'Invalid bootstrap secret' },
        { status: 401 }
      );
    }

    if (message.includes('ADMIN_BOOTSTRAP_SECRET is not configured')) {
      return NextResponse.json(
        { error: 'Administrator setup is not configured' },
        { status: 500 }
      );
    }

    console.error('POST /api/auth/bootstrap error:', error);

    return NextResponse.json(
      { error: 'Administrator setup failed' },
      { status: 500 }
    );
  }
}
