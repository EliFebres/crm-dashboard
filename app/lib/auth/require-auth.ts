import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT, SESSION_COOKIE } from './jwt';
import type { JWTPayload } from './jwt';
import type { ServerConstraints } from '../db/queries';
import { READ_ONLY_TEAMS, toDisplayName } from './types';
import { touchPresence } from '../activity/log';

export type AuthResult =
  | { payload: JWTPayload; error: null }
  | { payload: null; error: NextResponse };

export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return { payload: null, error: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }) };
  }
  try {
    const payload = await verifyJWT(token);
    if (!payload.team && payload.role !== 'admin') {
      return { payload: null, error: NextResponse.json({ error: 'Session expired. Please log in again.' }, { status: 401 }) };
    }
    void touchPresence(
      payload.sub,
      payload.email,
      `${payload.firstName} ${payload.lastName}`.trim()
    );
    return { payload, error: null };
  } catch {
    return { payload: null, error: NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 }) };
  }
}

export function isReadOnly(payload: JWTPayload): boolean {
  return (READ_ONLY_TEAMS as readonly string[]).includes(payload.team);
}

export function canModify(payload: JWTPayload): boolean {
  return !isReadOnly(payload);
}

export function readOnlyError(): NextResponse {
  return NextResponse.json(
    { error: 'This account has read-only access and cannot modify data.' },
    { status: 403 }
  );
}

export function canEditEngagement(payload: JWTPayload, teamMembers: string[]): boolean {
  if (!canModify(payload)) return false;
  if (payload.role === 'admin') return true;
  return teamMembers.includes(toDisplayName(payload.firstName, payload.lastName));
}

export function notTeamMemberError(): NextResponse {
  return NextResponse.json(
    { error: 'Only assigned Team Members can edit this project.' },
    { status: 403 }
  );
}

export function teamConstraint(payload: JWTPayload): ServerConstraints {
  if (payload.role === 'admin' || isReadOnly(payload)) return { team: undefined };
  return { team: payload.team };
}

export type KpiScope = 'all' | `team:${string}`;

// KPI dashboard allows cross-team aggregates, but non-admins may only scope
// to 'all' (cross-team totals) or to their own team — no peeking at another
// team's team-level breakdown. Admins may scope to any team.
export function kpiConstraint(scope: KpiScope): ServerConstraints {
  if (scope === 'all') return {};
  const team = scope.slice('team:'.length);
  return { team };
}

export function canAccessKpiScope(payload: JWTPayload, scope: KpiScope): boolean {
  if (scope === 'all') return true;
  if (payload.role === 'admin') return true;
  const team = scope.slice('team:'.length);
  return team === payload.team;
}

export function isValidKpiScope(scope: unknown): scope is KpiScope {
  if (scope === 'all') return true;
  if (typeof scope !== 'string') return false;
  if (!scope.startsWith('team:')) return false;
  const team = scope.slice('team:'.length);
  return team.length > 0;
}
