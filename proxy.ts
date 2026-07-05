import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE = 'crm_session';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return new TextEncoder().encode(secret);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  let payload: { role?: string; status?: string } | null = null;
  if (token) {
    try {
      const result = await jwtVerify(token, getSecret());
      payload = result.payload as { role?: string; status?: string };
    } catch {
      payload = null;
    }
  }

  const isAuthenticated = payload !== null && payload.status === 'active';
  const isAdmin = isAuthenticated && payload?.role === 'admin';

  // Logged-in users on landing page → send to dashboard, UNLESS they explicitly
  // asked to view the homepage (e.g. clicked the sidebar brand → /?home=1).
  if (pathname === '/' && isAuthenticated && !req.nextUrl.searchParams.has('home')) {
    return NextResponse.redirect(new URL('/dashboard/interactions-and-trends/client-interactions', req.url));
  }

  // Redirect already-authenticated users away from login/signup
  if ((pathname === '/login' || pathname === '/signup') && isAuthenticated) {
    return NextResponse.redirect(new URL('/dashboard/interactions-and-trends/client-interactions', req.url));
  }

  // Protect API routes — return JSON 401/403 (no redirect)
  if (pathname.startsWith('/api/')) {
    if (!isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (pathname.startsWith('/api/admin/') && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // Protect /dashboard/* — require active session
  if (pathname.startsWith('/dashboard/') && !isAuthenticated) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Protect /admin/* — require active session + admin role
  if (pathname.startsWith('/admin/')) {
    if (!isAuthenticated) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    if (!isAdmin) {
      return NextResponse.redirect(new URL('/dashboard/interactions-and-trends/client-interactions', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/dashboard/:path*',
    '/admin/:path*',
    '/login',
    '/signup',
    '/api/client-interactions/:path*',
    '/api/admin/:path*',
  ],
};
