import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { verifyJWT, SESSION_COOKIE } from '../auth/jwt';
import type { JWTPayload } from '../auth/jwt';
import { executeActivity } from '../db/activity';
import { queryUsers } from '../db/users';
import { emitActivityLog, type ActivityLogRow } from '../events';

export interface LogActivityParams {
  action: string;
  entityType?: string | null;
  entityId?: string | number | null;
  details?: Record<string, unknown> | null;
  // Use when the request isn't authenticated yet (e.g. failed login, signup).
  userOverride?: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
    office?: string | null;
  };
}

// In-memory cache to avoid hitting the users DB on every log write.
const officeCache = new Map<string, string | null>();

// Retention sweep — drop rows older than 30 days. Throttled to at most once per hour
// so we don't pay for a DELETE on every insert. Does NOT touch Client Interactions
// (engagements) — those live in a separate DB.
const RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let _lastCleanup = 0;

function maybeRunRetentionSweep(): void {
  const now = Date.now();
  if (now - _lastCleanup < CLEANUP_INTERVAL_MS) return;
  _lastCleanup = now;
  void executeActivity(
    `DELETE FROM activity_logs WHERE datetime(timestamp) < datetime('now', '-${RETENTION_DAYS} days')`
  ).catch(err => console.error('[activity] retention sweep failed:', err));
}

async function resolveOffice(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  if (officeCache.has(userId)) return officeCache.get(userId) ?? null;
  try {
    const rows = await queryUsers<{ office: string | null }>(
      `SELECT office FROM users WHERE id = ?`,
      [userId]
    );
    const office = rows[0]?.office ?? null;
    officeCache.set(userId, office);
    return office;
  } catch {
    return null;
  }
}

function extractIp(req: NextRequest | null): string | null {
  if (!req) return null;
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? null;
}

function extractUserAgent(req: NextRequest | null): string | null {
  if (!req) return null;
  return req.headers.get('user-agent') ?? null;
}

async function resolvePayload(req: NextRequest | null): Promise<JWTPayload | null> {
  if (!req) return null;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifyJWT(token);
  } catch {
    return null;
  }
}

export async function logActivity(
  req: NextRequest | null,
  params: LogActivityParams
): Promise<void> {
  try {
    const payload = await resolvePayload(req);

    const userId = params.userOverride?.id ?? payload?.sub ?? null;
    const userEmail = params.userOverride?.email ?? payload?.email ?? null;
    const userName = params.userOverride?.name
      ?? (payload ? `${payload.firstName} ${payload.lastName}`.trim() : null);
    const userOffice = params.userOverride?.office ?? await resolveOffice(userId);

    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const entityId = params.entityId == null ? null : String(params.entityId);
    const detailsJson = params.details ? JSON.stringify(params.details) : null;
    const ip = extractIp(req);
    const userAgent = extractUserAgent(req);

    await executeActivity(
      `INSERT INTO activity_logs
       (id, timestamp, user_id, user_email, user_name, user_office, action, entity_type, entity_id, details, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        timestamp,
        userId,
        userEmail,
        userName,
        userOffice,
        params.action,
        params.entityType ?? null,
        entityId,
        detailsJson,
        ip,
        userAgent,
      ]
    );

    const row: ActivityLogRow = {
      id,
      timestamp,
      userId,
      userEmail,
      userName,
      userOffice,
      action: params.action,
      entityType: params.entityType ?? null,
      entityId,
      details: params.details ?? null,
      ip,
      userAgent,
    };
    emitActivityLog(row);
    maybeRunRetentionSweep();
  } catch (err) {
    // Logging must never break the request path.
    console.error('[activity] logActivity failed:', err);
  }
}

export async function touchPresence(
  userId: string,
  userEmail: string,
  userName: string
): Promise<void> {
  try {
    await executeActivity(
      `INSERT OR REPLACE INTO user_presence (user_id, user_email, user_name, last_seen)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [userId, userEmail, userName]
    );
  } catch (err) {
    console.error('[activity] touchPresence failed:', err);
  }
}
