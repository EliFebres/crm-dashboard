'use client';

import { useEffect } from 'react';

/**
 * entityType values logged by the registry mutation routes (see logActivity
 * calls in app/api/{teams,offices,titles,project-types,intake-types,...}).
 */
export type SettingsEntity =
  | 'team'
  | 'office'
  | 'title'
  | 'projectType'
  | 'intakeType'
  | 'team_member'
  | 'user';

type Subscriber = (entity: string) => void;

// One EventSource shared across every settings manager on the page, multiplexed
// to all subscribers. Module-level so the Teams/Offices/Titles/Types/roster
// tables share a single stream instead of opening one connection each.
let source: EventSource | null = null;
const subscribers = new Set<Subscriber>();

function ensureStream(): void {
  if (source || typeof window === 'undefined') return;
  // Registry mutations all flow through logActivity → activityEmitter, so the
  // existing admin activity stream already carries every change we care about.
  source = new EventSource('/api/activity/events');
  source.onmessage = (e) => {
    let msg: { type?: string; row?: { entityType?: string | null } };
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg?.type !== 'log' || !msg.row?.entityType) return;
    const entity = msg.row.entityType;
    subscribers.forEach(fn => fn(entity));
  };
  // Leave the default (auto-reconnecting) error behavior — a settings page can
  // stay open a long time, and transient blips should recover on their own.
}

/**
 * Invoke `onChange(entityType)` whenever any admin anywhere mutates a registry
 * (team/office/title/type/roster/user). `onChange` must be stable (useCallback)
 * — callers filter on the entity and refetch their own list.
 */
export function useSettingsStream(onChange: Subscriber): void {
  useEffect(() => {
    subscribers.add(onChange);
    ensureStream();
    return () => {
      subscribers.delete(onChange);
      if (subscribers.size === 0 && source) {
        source.close();
        source = null;
      }
    };
  }, [onChange]);
}
