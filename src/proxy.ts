import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware for authentication and authorization.
 *
 * Protects:
 * - /dashboard/*
 * - /vms/*
 * - /api/vms/*
 *
 * Allows unauthenticated:
 * - /login
 * - /api/health
 * - /api/agent/* (agent endpoints use Bearer auth)
 * - Static assets
 */

const PUBLIC_PATHS = new Set([
  '/login',
  '/setup',
  '/api/health',
  '/api/agent/enroll',
  '/api/auth/bootstrap',
  '/api/agent/poll',
]);

const PUBLIC_PREFIXES = [
  '/_next/',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

function isAgentApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/agent/');
}

function isVmApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/vms/');
}

function isProtectedPath(pathname: string): boolean {
  return (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/vms') ||
    isVmApiPath(pathname)
  );
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Allow public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Agent API uses Bearer token auth (handled in worker)
  if (isAgentApiPath(pathname)) {
    return NextResponse.next();
  }

  // Check for session cookie on protected paths
  if (isProtectedPath(pathname)) {
    const sessionToken = request.cookies.get('rdp_session')?.value;

    if (!sessionToken) {
      // Redirect to login for page routes, return 401 for API routes
      if (pathname.startsWith('/api/')) {
        return new NextResponse(JSON.stringify({ error: 'Unauthorized', code: 'unauthenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Session validation happens in the API routes / server components
    // Middleware just checks for cookie presence
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};