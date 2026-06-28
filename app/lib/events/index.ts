import { EventEmitter } from 'events';

// Single in-process emitter shared across all route handlers.
// Works because Next.js and SQLite run in the same Node.js process.
// NOTE: This approach does not work in serverless/edge deployments.

declare global {
  var _engagementEmitter: EventEmitter | undefined;
  var _userEmitter: EventEmitter | undefined;
  var _activityEmitter: EventEmitter | undefined;
}

if (!global._engagementEmitter) {
  global._engagementEmitter = new EventEmitter();
  global._engagementEmitter.setMaxListeners(100);
}

if (!global._userEmitter) {
  global._userEmitter = new EventEmitter();
  global._userEmitter.setMaxListeners(100);
}

if (!global._activityEmitter) {
  global._activityEmitter = new EventEmitter();
  global._activityEmitter.setMaxListeners(100);
}

export const engagementEmitter = global._engagementEmitter;
export const userEmitter = global._userEmitter;
export const activityEmitter = global._activityEmitter;

export type EngagementEventType = 'created' | 'updated' | 'deleted';
export type UserEventType = 'created' | 'deleted';

export interface ActivityLogRow {
  id: string;
  timestamp: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  userOffice: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
}

export function emitEngagementChange(type: EngagementEventType) {
  engagementEmitter.emit('change', type);
}

export function emitUserChange(type: UserEventType) {
  userEmitter.emit('change', type);
}

export function emitActivityLog(row: ActivityLogRow) {
  activityEmitter.emit('log', row);
}
