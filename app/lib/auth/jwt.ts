import { SignJWT, jwtVerify } from 'jose';

export interface JWTPayload {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'user' | 'admin';
  status: 'pending' | 'active' | 'inactive';
  team:
    | 'Portfolio Consulting Group'
    | 'Equity Specialist'
    | 'Fixed Income Specialist'
    | 'Leadership'
    | 'Guest';
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
