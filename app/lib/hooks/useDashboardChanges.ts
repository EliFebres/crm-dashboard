'use client';

import { useEffect, useRef, useState } from 'react';
import type { DashboardData } from '@/app/lib/api/client-interactions';
import type { Engagement } from '@/app/lib/types/engagements';
import { isCompletedStatus } from '@/app/lib/statusHelpers';

export type FlashKind = 'neutral' | 'blue' | 'green' | 'red' | 'amber';

export interface ChangeFlash {
  kind: FlashKind;
  nonce: number;
}

export type EngagementField =
  | 'status'
  | 'noteCount'
  | 'nna'
  | 'portfolioLogged'
  | 'intakeType'
  | 'type'
  | 'dateFinished'
  | 'teamMembers';

export type MetricKey = 'Client Projects' | 'GCG Ad-Hoc' | 'In Progress' | 'NNA';

export interface DashboardChanges {
  newRowIds: Map<number, ChangeFlash>;
  removedRowIds: Map<number, ChangeFlash>;
  rowFieldChanges: Map<number, Partial<Record<EngagementField, ChangeFlash>>>;
  metricChanges: Partial<Record<MetricKey, ChangeFlash>>;
  contributionChanges: Map<string, ChangeFlash>;
  departmentChanges: Record<string, ChangeFlash>;
}

const EMPTY: DashboardChanges = {
  newRowIds: new Map(),
  removedRowIds: new Map(),
  rowFieldChanges: new Map(),
  metricChanges: {},
  contributionChanges: new Map(),
  departmentChanges: {},
};

const FLASH_DURATION_MS = 1200;

function diffEngagementField(
  field: EngagementField,
  prev: Engagement,
  next: Engagement,
  mkNonce: () => number,
): ChangeFlash | null {
  switch (field) {
    case 'status': {
      if (prev.status === next.status) return null;
      if (isCompletedStatus(next.status)) return { kind: 'green', nonce: mkNonce() };
      return { kind: 'amber', nonce: mkNonce() };
    }
    case 'noteCount': {
      const a = prev.noteCount ?? 0;
      const b = next.noteCount ?? 0;
      if (a === b) return null;
      return { kind: b > a ? 'blue' : 'red', nonce: mkNonce() };
    }
    case 'nna': {
      const a = prev.nna ?? 0;
      const b = next.nna ?? 0;
      if (a === b) return null;
      return { kind: 'blue', nonce: mkNonce() };
    }
    case 'portfolioLogged': {
      if (prev.portfolioLogged === next.portfolioLogged) return null;
      return { kind: next.portfolioLogged ? 'green' : 'neutral', nonce: mkNonce() };
    }
    case 'intakeType': {
      if (prev.intakeType === next.intakeType) return null;
      return { kind: 'amber', nonce: mkNonce() };
    }
    case 'type': {
      if (prev.type === next.type) return null;
      return { kind: 'amber', nonce: mkNonce() };
    }
    case 'dateFinished': {
      if (prev.dateFinished === next.dateFinished) return null;
      return { kind: 'neutral', nonce: mkNonce() };
    }
    case 'teamMembers': {
      if (JSON.stringify(prev.teamMembers) === JSON.stringify(next.teamMembers)) return null;
      return { kind: 'neutral', nonce: mkNonce() };
    }
  }
}

const TRACKED_FIELDS: EngagementField[] = [
  'status',
  'noteCount',
  'nna',
  'portfolioLogged',
  'intakeType',
  'type',
  'dateFinished',
  'teamMembers',
];

function computeDiff(
  prev: DashboardData,
  next: DashboardData,
  mkNonce: () => number,
): DashboardChanges {
  const out: DashboardChanges = {
    newRowIds: new Map(),
    removedRowIds: new Map(),
    rowFieldChanges: new Map(),
    metricChanges: {},
    contributionChanges: new Map(),
    departmentChanges: {},
  };

  // Engagements
  const prevById = new Map(prev.engagements.engagements.map(e => [e.id, e]));
  const nextById = new Map(next.engagements.engagements.map(e => [e.id, e]));
  for (const [id, e] of nextById) {
    const prevE = prevById.get(id);
    if (!prevE) {
      out.newRowIds.set(id, { kind: 'neutral', nonce: mkNonce() });
      continue;
    }
    const fieldChanges: Partial<Record<EngagementField, ChangeFlash>> = {};
    let changed = false;
    for (const f of TRACKED_FIELDS) {
      const flash = diffEngagementField(f, prevE, e, mkNonce);
      if (flash) { fieldChanges[f] = flash; changed = true; }
    }
    if (changed) out.rowFieldChanges.set(id, fieldChanges);
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) out.removedRowIds.set(id, { kind: 'red', nonce: mkNonce() });
  }

  // Metrics
  const metricDiffs: [MetricKey, number, number][] = [
    ['Client Projects', prev.metrics.clientProjects.count, next.metrics.clientProjects.count],
    ['GCG Ad-Hoc', prev.metrics.gcgAdHoc.count, next.metrics.gcgAdHoc.count],
    ['In Progress', prev.metrics.inProgress.count, next.metrics.inProgress.count],
    ['NNA', prev.metrics.nna.total, next.metrics.nna.total],
  ];
  for (const [key, a, b] of metricDiffs) {
    if (a !== b) out.metricChanges[key] = { kind: b > a ? 'green' : 'red', nonce: mkNonce() };
  }

  // Contribution graph
  const prevLevels = new Map<string, number>();
  for (const week of prev.contributionData.weeks) {
    for (const day of week) prevLevels.set(String(day.date), day.level);
  }
  for (const week of next.contributionData.weeks) {
    for (const day of week) {
      const key = String(day.date);
      const prevLevel = prevLevels.get(key);
      if (prevLevel !== undefined && prevLevel !== day.level) {
        out.contributionChanges.set(key, {
          kind: day.level > prevLevel ? 'green' : 'neutral',
          nonce: mkNonce(),
        });
      }
    }
  }

  // Department chart
  const prevDepts = new Map(prev.departments.departments.map(d => [d.name, d.count]));
  for (const d of next.departments.departments) {
    const prevCount = prevDepts.get(d.name);
    if (prevCount !== undefined && prevCount !== d.count) {
      out.departmentChanges[d.name] = {
        kind: d.count > prevCount ? 'green' : 'red',
        nonce: mkNonce(),
      };
    }
  }

  return out;
}

function isEmpty(c: DashboardChanges): boolean {
  return (
    c.newRowIds.size === 0 &&
    c.removedRowIds.size === 0 &&
    c.rowFieldChanges.size === 0 &&
    Object.keys(c.metricChanges).length === 0 &&
    c.contributionChanges.size === 0 &&
    Object.keys(c.departmentChanges).length === 0
  );
}

function mergeChanges(base: DashboardChanges, add: DashboardChanges): DashboardChanges {
  const rowFieldChanges = new Map(base.rowFieldChanges);
  for (const [id, fields] of add.rowFieldChanges) {
    rowFieldChanges.set(id, { ...(rowFieldChanges.get(id) ?? {}), ...fields });
  }
  return {
    newRowIds: new Map([...base.newRowIds, ...add.newRowIds]),
    removedRowIds: new Map([...base.removedRowIds, ...add.removedRowIds]),
    rowFieldChanges,
    metricChanges: { ...base.metricChanges, ...add.metricChanges },
    contributionChanges: new Map([...base.contributionChanges, ...add.contributionChanges]),
    departmentChanges: { ...base.departmentChanges, ...add.departmentChanges },
  };
}

function pruneExpired(current: DashboardChanges, expired: DashboardChanges): DashboardChanges {
  const removeMap = <K>(cur: Map<K, ChangeFlash>, exp: Map<K, ChangeFlash>): Map<K, ChangeFlash> => {
    const out = new Map(cur);
    for (const [k, v] of exp) {
      const curV = out.get(k);
      if (curV && curV.nonce === v.nonce) out.delete(k);
    }
    return out;
  };
  const removeObj = <K extends string>(
    cur: Partial<Record<K, ChangeFlash>>,
    exp: Partial<Record<K, ChangeFlash>>,
  ): Partial<Record<K, ChangeFlash>> => {
    const out: Partial<Record<K, ChangeFlash>> = { ...cur };
    for (const k of Object.keys(exp) as K[]) {
      const curV = out[k];
      const expV = exp[k];
      if (curV && expV && curV.nonce === expV.nonce) delete out[k];
    }
    return out;
  };

  const rowFieldChanges = new Map(current.rowFieldChanges);
  for (const [id, expiredFields] of expired.rowFieldChanges) {
    const currentFields = rowFieldChanges.get(id);
    if (!currentFields) continue;
    const nextFields: Partial<Record<EngagementField, ChangeFlash>> = { ...currentFields };
    for (const f of Object.keys(expiredFields) as EngagementField[]) {
      const cur = nextFields[f];
      const exp = expiredFields[f];
      if (cur && exp && cur.nonce === exp.nonce) delete nextFields[f];
    }
    if (Object.keys(nextFields).length === 0) rowFieldChanges.delete(id);
    else rowFieldChanges.set(id, nextFields);
  }

  return {
    newRowIds: removeMap(current.newRowIds, expired.newRowIds),
    removedRowIds: removeMap(current.removedRowIds, expired.removedRowIds),
    rowFieldChanges,
    metricChanges: removeObj(current.metricChanges, expired.metricChanges),
    contributionChanges: removeMap(current.contributionChanges, expired.contributionChanges),
    departmentChanges: removeObj(current.departmentChanges, expired.departmentChanges) as Record<string, ChangeFlash>,
  };
}

/**
 * Diffs incoming dashboard snapshots against the previous snapshot and returns a
 * rolling map of "recently changed" flash tokens. Tokens auto-expire after ~1.1s.
 * Skip-diffs on first load and whenever filtersKey changes, so filter toggles
 * don't trigger a flash storm.
 */
export function useDashboardChanges(
  data: DashboardData | null,
  filtersKey: string,
): DashboardChanges {
  const prevRef = useRef<{ data: DashboardData; filtersKey: string } | null>(null);
  const nonceRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [changes, setChanges] = useState<DashboardChanges>(EMPTY);

  useEffect(() => {
    if (!data) return;
    const prev = prevRef.current;

    if (!prev || prev.filtersKey !== filtersKey) {
      prevRef.current = { data, filtersKey };
      return;
    }

    const diff = computeDiff(prev.data, data, () => ++nonceRef.current);
    prevRef.current = { data, filtersKey };

    if (isEmpty(diff)) return;

    setChanges(cur => mergeChanges(cur, diff));

    const timer = setTimeout(() => {
      setChanges(cur => pruneExpired(cur, diff));
      timersRef.current.delete(timer);
    }, FLASH_DURATION_MS);
    timersRef.current.add(timer);
  }, [data, filtersKey]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(t => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return changes;
}

export const FLASH_CLASS: Record<FlashKind, string> = {
  neutral: 'flash-neutral',
  blue: 'flash-blue',
  green: 'flash-green',
  red: 'flash-red',
  amber: 'flash-amber',
};

/** Text-color flash variants — recolor the text itself instead of the background. */
export const FLASH_TEXT_CLASS: Record<FlashKind, string> = {
  neutral: 'flash-text-neutral',
  blue: 'flash-text-blue',
  green: 'flash-text-green',
  red: 'flash-text-red',
  amber: 'flash-text-amber',
};
