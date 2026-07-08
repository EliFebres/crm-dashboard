'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import {
  getHotTickers,
  getTickerTrendsFilterOptions,
  updateHotTickerType,
  updateHotTickerTalkingPoints,
  updateHotTickerPCR,
  type FilterOptions,
  type TickerType,
} from '@/app/lib/api/ticker-trends';
import type { HotTicker } from '@/app/lib/types/trends';
import type { BaseNote } from '@/app/lib/types/engagements';
import { useCurrentUser } from '@/app/lib/auth/context';
import DashboardHeader from '@/app/components/dashboard/shared/DashboardHeader';
import NotesModal, { type NoteSource } from '@/app/components/dashboard/interactions-and-trends/client-interactions/NotesModal';
import LinkModal from '@/app/components/dashboard/interactions-and-trends/ticker-trends/LinkModal';
import HotTickersTable from '@/app/components/dashboard/interactions-and-trends/ticker-trends/HotTickersTable';
import MatchupRail from '@/app/components/dashboard/interactions-and-trends/ticker-trends/MatchupRail';
import TickerKpiBand from '@/app/components/dashboard/interactions-and-trends/ticker-trends/TickerKpiBand';
import { type Department, reqOf, avgQoq } from '@/app/components/dashboard/interactions-and-trends/ticker-trends/compute';

// Rail section costs (px) used to drop-by-priority when the viewport is short.
const FIXED = 512;       // header + why hot + who's asking + proof points + buttons
const MOMENTUM = 230;
const NOTES = 132;

export default function TickerTrendsDashboard() {
  const [departmentFilter, setDepartmentFilter] = useState('All Departments');
  const [period, setPeriod] = useState('1Y');

  const { user } = useCurrentUser();
  const [hotTickers, setHotTickers] = useState<HotTicker[]>([]);
  // Fresh snapshot for the notes source's closures (reads without dep churn).
  const hotTickersRef = useRef(hotTickers);
  hotTickersRef.current = hotTickers;
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    departments: ['All Departments'],
    periods: ['1Y'],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedTicker, setSelectedTicker] = useState('IJR');
  const [openStanceRank, setOpenStanceRank] = useState<number | null>(null);

  // Rail section visibility (dropped by priority on short viewports)
  const [showMomentum, setShowMomentum] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  // Modal targets
  const [notesModalTicker, setNotesModalTicker] = useState<HotTicker | null>(null);
  const [talkingPointsModalTicker, setTalkingPointsModalTicker] = useState<HotTicker | null>(null);
  const [pcrModalTicker, setPcrModalTicker] = useState<HotTicker | null>(null);

  // Which note each ticker shows on the rail panel (chosen in the Notes modal).
  const [pinnedNotes, setPinnedNotes] = useState<Record<string, number>>({});

  const department = departmentFilter as Department;

  // ── Data fetching ──────────────────────────────────────────────────────────
  useEffect(() => {
    getTickerTrendsFilterOptions().then(setFilterOptions);
  }, []);

  const fetchHotTickers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getHotTickers({ department: departmentFilter, period });
      setHotTickers(response.tickers);
    } catch (err) {
      setError('Failed to load hot tickers data');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [departmentFilter, period]);

  useEffect(() => {
    fetchHotTickers();
  }, [fetchHotTickers]);

  // Keep the selected matchup valid once data loads.
  useEffect(() => {
    if (hotTickers.length && !hotTickers.some((t) => t.ticker === selectedTicker)) {
      setSelectedTicker(hotTickers[0].ticker);
    }
  }, [hotTickers, selectedTicker]);

  // ── Rail drop-by-priority (short viewports drop Momentum, then Notes) ─────────
  useEffect(() => {
    const measure = () => {
      const tbody = tbodyRef.current;
      if (!tbody) return;
      // Anchor to the scroll container's top (stable regardless of internal scroll).
      const wrapper = tbody.closest('table')?.parentElement ?? null;
      const top = (wrapper ?? tbody).getBoundingClientRect().top;
      const avail = window.innerHeight - top - 24;
      setShowMomentum(avail >= FIXED + MOMENTUM);
      setShowNotes(avail >= FIXED + MOMENTUM + NOTES);
    };
    const raf = requestAnimationFrame(measure);
    const t1 = setTimeout(measure, 120);
    const t2 = setTimeout(measure, 400);
    window.addEventListener('resize', measure);
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(measure).catch(() => {});
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', measure);
    };
  }, [isLoading]);

  // ── Close the stance menu on outside mousedown ───────────────────────────────
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.closest('[data-dropdown]')) setOpenStanceRank(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // ── Optimistic updates (with rollback) ───────────────────────────────────────
  const handleTypeChange = useCallback(async (ticker: string, newType: TickerType) => {
    const previous = hotTickers;
    setHotTickers((prev) => prev.map((t) => (t.ticker === ticker ? { ...t, type: newType } : t)));
    try {
      await updateHotTickerType(ticker, newType);
    } catch (err) {
      console.error('Failed to update ticker type:', err);
      setHotTickers(previous);
    }
  }, [hotTickers]);

  const handleTalkingPointsChange = useCallback(async (ticker: string, talkingPointsUrl: string) => {
    const previous = hotTickers;
    setHotTickers((prev) => prev.map((t) => (t.ticker === ticker ? { ...t, talkingPointsUrl } : t)));
    try {
      await updateHotTickerTalkingPoints(ticker, talkingPointsUrl);
    } catch (err) {
      console.error('Failed to update talking points:', err);
      setHotTickers(previous);
    }
  }, [hotTickers]);

  const handlePCRChange = useCallback(async (ticker: string, pcrUrl: string) => {
    const previous = hotTickers;
    setHotTickers((prev) => prev.map((t) => (t.ticker === ticker ? { ...t, pcrUrl } : t)));
    try {
      await updateHotTickerPCR(ticker, pcrUrl);
    } catch (err) {
      console.error('Failed to update PCR:', err);
      setHotTickers(previous);
    }
  }, [hotTickers]);

  const onSetStance = useCallback((rank: number, type: string) => {
    const t = hotTickers.find((x) => x.rank === rank);
    if (t) handleTypeChange(t.ticker, type as TickerType);
    setOpenStanceRank(null);
  }, [hotTickers, handleTypeChange]);

  // ── Derived view (department sort — all rows, scrolled within the table) ──────
  const derived = useMemo(() => {
    const view = [...hotTickers].sort((a, b) => reqOf(b, department) - reqOf(a, department));
    const maxReq = Math.max(1, ...view.map((t) => reqOf(t, department)));
    return { view, maxReq };
  }, [hotTickers, department]);

  const { view, maxReq } = derived;

  const deptSel = department !== 'All Departments';
  const grandTotal = useMemo(() => hotTickers.reduce((a, t) => a + t.requests, 0), [hotTickers]);
  const avg = useMemo(() => avgQoq(hotTickers), [hotTickers]);
  const selected = hotTickers.find((t) => t.ticker === selectedTicker) ?? view[0] ?? hotTickers[0];

  // Notes are authored by the logged-in team member. The modal's CRUD is injected
  // here (client-side mock store) so it stays in sync with the rail's note panel.
  const noteAuthorName = user ? `${user.firstName} ${user.lastName}`.trim() || user.email : 'You';
  const noteAuthorId = user?.id ?? 'me';
  const notesSource = useMemo<NoteSource | null>(() => {
    const target = notesModalTicker;
    if (!target) return null;
    const tk = target.ticker;
    const patch = (fn: (list: BaseNote[]) => BaseNote[]) =>
      setHotTickers((prev) => prev.map((x) => (x.ticker === tk ? { ...x, noteEntries: fn(x.noteEntries) } : x)));
    const currentNotes = () => hotTickersRef.current.find((x) => x.ticker === tk)?.noteEntries ?? [];
    return {
      fetch: async () => currentNotes(),
      add: async (text) => {
        const note: BaseNote = {
          id: Date.now(), noteText: text, authorName: noteAuthorName, authorId: noteAuthorId,
          createdAt: new Date().toISOString(),
        };
        patch((list) => [...list, note]);
        return note;
      },
      update: async (noteId, text) => {
        const existing = currentNotes().find((n) => n.id === noteId);
        const updated: BaseNote = existing
          ? { ...existing, noteText: text }
          : { id: noteId, noteText: text, authorName: noteAuthorName, authorId: noteAuthorId, createdAt: new Date().toISOString() };
        patch((list) => list.map((n) => (n.id === noteId ? updated : n)));
        return updated;
      },
      remove: async (noteId) => {
        patch((list) => list.filter((n) => n.id !== noteId));
      },
    };
  }, [notesModalTicker, noteAuthorName, noteAuthorId]);

  const pageTitle = `Top ${view.length} Hot Tickers`;
  const reqHeader = deptSel ? department.slice(0, 5) + '. requests' : 'Requests';
  const tableCaption = deptSel
    ? `Demand from the ${department} team · click a row to open the matchup`
    : `${grandTotal} requests this period · click a row to open the matchup`;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <DashboardHeader
        title="Ticker Trends"
        subtitle="What clients ask about — and how we answer"
        hideSearch
        alwaysShowFilters
        filtersInline
        filters={[
          {
            id: 'department',
            icon: Building2,
            label: 'Department',
            options: filterOptions.departments,
            value: departmentFilter,
            onChange: (v: string | string[]) => setDepartmentFilter(v as string),
          },
        ]}
        period={period}
        onPeriodChange={setPeriod}
        periodOptions={filterOptions.periods}
      />

      {isLoading && !hotTickers.length ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
          <span className="ml-2 text-sm text-muted">Loading ticker trends…</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-sm text-red-400">{error}</div>
      ) : selected ? (
        <div className="flex-1 min-h-0 flex flex-col gap-5 px-7 pt-5 pb-6 overflow-hidden">
          <TickerKpiBand tickers={hotTickers} department={department} />

          <div className="flex-1 min-h-0 flex gap-5 items-stretch">
            <HotTickersTable
              rows={view}
              maxReq={maxReq}
              department={department}
              selectedTicker={selectedTicker}
              onSelect={setSelectedTicker}
              openStanceRank={openStanceRank}
              onToggleStance={(rank) => setOpenStanceRank((r) => (r === rank ? null : rank))}
              onSetStance={onSetStance}
              pageTitle={pageTitle}
              tableCaption={tableCaption}
              reqHeader={reqHeader}
              tbodyRef={tbodyRef}
            />

            <MatchupRail
              ticker={selected}
              avg={avg}
              showMomentum={showMomentum}
              showNotes={showNotes}
              pinnedNoteId={pinnedNotes[selected.ticker] ?? null}
              onNotes={() => setNotesModalTicker(selected)}
              onTalk={() => setTalkingPointsModalTicker(selected)}
              onPcr={() => setPcrModalTicker(selected)}
            />
          </div>
        </div>
      ) : null}

      {/* Notes Modal — the same rich, multi-note modal used on Client Interactions */}
      <NotesModal
        isOpen={notesModalTicker !== null}
        onClose={() => setNotesModalTicker(null)}
        title="Ticker Notes"
        subtitle={
          <>
            <span className="text-cyan-400 font-medium">{notesModalTicker?.ticker}</span>
            <span className="text-muted mx-1">·</span>
            {notesModalTicker?.name}
          </>
        }
        notesSource={notesSource ?? undefined}
        resourceKey={notesModalTicker?.ticker}
        pinnedNoteId={notesModalTicker ? pinnedNotes[notesModalTicker.ticker] ?? null : null}
        onPinNote={(noteId) => {
          if (notesModalTicker) setPinnedNotes((prev) => ({ ...prev, [notesModalTicker.ticker]: noteId }));
        }}
      />

      {/* Talking Points Modal */}
      <LinkModal
        isOpen={talkingPointsModalTicker !== null}
        onClose={() => setTalkingPointsModalTicker(null)}
        title="Talking Points Link"
        label="Internal Link URL"
        ticker={talkingPointsModalTicker?.ticker ?? ''}
        tickerName={talkingPointsModalTicker?.name ?? ''}
        currentUrl={talkingPointsModalTicker?.talkingPointsUrl ?? ''}
        onSave={handleTalkingPointsChange}
        placeholder="https://internal.site/talking-points/..."
      />

      {/* PCR Modal */}
      <LinkModal
        isOpen={pcrModalTicker !== null}
        onClose={() => setPcrModalTicker(null)}
        title="Product Comparison Report"
        label="PCR Document Link"
        ticker={pcrModalTicker?.ticker ?? ''}
        tickerName={pcrModalTicker?.name ?? ''}
        currentUrl={pcrModalTicker?.pcrUrl ?? ''}
        onSave={handlePCRChange}
        placeholder="https://internal.site/pcr/..."
      />
    </div>
  );
}
