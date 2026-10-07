import { SignJWT, jwtVerify } from 'jose';

export interface JWTPayload {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'user' | 'admin';
  status: 'pending' | 'active' | 'inactive';
  // Admin-managed list stored in the DB — see app/lib/db/org.ts.
  team: string;
}

export const SESSION_COOKIE = 'crm_session';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days in seconds
};

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return new TextEncoder().encode(secret);
}

export async function signJWT(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret());
}

export async function verifyJWT(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as JWTPayload;
}

// Payloads already verified for a request, so later helpers in the same request
// (e.g. logActivity) don't re-verify the same cookie.
const verifiedByRequest = new WeakMap<object, JWTPayload>();

export function rememberVerified(req: object, payload: JWTPayload): void {
  verifiedByRequest.set(req, payload);
}

export function getVerified(req: object): JWTPayload | undefined {
  return verifiedByRequest.get(req);
}
