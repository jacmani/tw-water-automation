'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import type { TowerName } from '@/types';
import { TOWER_COLORS } from '@/lib/utils';
import { computeFlag } from './flagging';
import { buildCsv, downloadCsv } from './csvExport';
import type { SheetRecord, HTowerRow, HSourceRow, HSummary } from './types';
import DailyTable from './DailyTable';
import HeatmapView from './HeatmapView';

const TOWERS: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function daysAgoStr(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().split('T')[0];
}

// ─── Supabase row types (as returned from embedded select) ────────────────────

interface RawTowerRow {
  tower: string;
  type: string;
  total_ltrs: number | null;
  r_yesterday: number | null;
  r_today: number | null;
  vol_yesterday: number | null;
  vol_today: number | null;
  diff: number | null;
  confidence: number | null;
}

interface RawSourceRow {
  location: string;
  source_type: string | null;
  r_yesterday: number | null;
  r_today: number | null;
  yesterday_ltrs: number | null;
  today_ltrs: number | null;
  total: number | null;
}

interface RawSummary {
  input_total: number | null;
  tower_usage: number | null;
  diff: number | null;
  v_side: number | null;
  n_side: number | null;
  jtr_tanker: number | null;
  mtr_tanker: number | null;
}

interface RawSheet {
  id: string;
  date: string;
  confidence_score: number | null;
  summary: RawSummary[] | RawSummary | null;
  tower_consumption: RawTowerRow[];
  water_sources: RawSourceRow[];
}

function normalise(raw: RawSheet): SheetRecord {
  const summaryRaw = Array.isArray(raw.summary) ? raw.summary[0] : raw.summary;
  const summary: HSummary | null = summaryRaw
    ? {
        input_total: summaryRaw.input_total,
        tower_usage: summaryRaw.tower_usage,
        diff: summaryRaw.diff,
        v_side: summaryRaw.v_side,
        n_side: summaryRaw.n_side,
        jtr_tanker: summaryRaw.jtr_tanker,
        mtr_tanker: summaryRaw.mtr_tanker,
      }
    : null;

  const tc: HTowerRow[] = (raw.tower_consumption ?? []).map(r => ({
    tower: r.tower as TowerName,
    type: r.type as 'DO' | 'DR',
    total_ltrs: r.total_ltrs,
    r_yesterday: r.r_yesterday,
    r_today: r.r_today,
    vol_yesterday: r.vol_yesterday,
    vol_today: r.vol_today,
    diff: r.diff,
    confidence: r.confidence,
  }));

  const ws: HSourceRow[] = (raw.water_sources ?? []).map(r => ({
    location: r.location,
    source_type: r.source_type,
    r_yesterday: r.r_yesterday,
    r_today: r.r_today,
    yesterday_ltrs: r.yesterday_ltrs,
    today_ltrs: r.today_ltrs,
    total: r.total,
  }));

  return {
    id: raw.id,
    date: raw.date,
    confidence_score: raw.confidence_score,
    summary,
    tower_consumption: tc,
    water_sources: ws,
    flag: computeFlag(summary, tc, ws),
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [view, setView] = useState<'table' | 'heatmap'>('table');
  const [towerFilter, setTowerFilter] = useState<TowerName | 'All'>('All');
  const [startDate, setStartDate] = useState(daysAgoStr(30));
  const [endDate, setEndDate] = useState(todayStr());
  const [sheets, setSheets] = useState<SheetRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const fetchData = useCallback(async (start: string, end: string) => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('daily_sheets')
      .select(`
        id,
        date,
        confidence_score,
        summary ( input_total, tower_usage, diff, v_side, n_side, jtr_tanker, mtr_tanker ),
        tower_consumption ( tower, type, total_ltrs, r_yesterday, r_today, vol_yesterday, vol_today, diff, confidence ),
        water_sources ( location, source_type, r_yesterday, r_today, yesterday_ltrs, today_ltrs, total )
      `)
      .eq('superseded', false)
      .eq('processed_status', 'processed')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: false });

    setLoading(false);
    if (err) { setError(err.message); return; }
    setSheets((data as unknown as RawSheet[]).map(normalise));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(startDate, endDate); }, [startDate, endDate, fetchData]);

  function applyPreset(days: number) {
    setStartDate(daysAgoStr(days));
    setEndDate(todayStr());
  }

  function handleCsv() {
    if (!sheets) return;
    const csv = buildCsv(sheets, towerFilter);
    downloadCsv(csv, startDate, endDate);
  }

  const flagCounts = sheets
    ? {
        ok: sheets.filter(s => s.flag.type === 'ok').length,
        flagged: sheets.filter(s => s.flag.type !== 'ok').length,
      }
    : null;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">Consumption History</h1>
            <p className="text-slate-400 text-xs mt-0.5">Full extraction record with cross-checks</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="text-slate-400 hover:text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors">
              ← Dashboard
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-5">

        {/* Controls bar */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          {/* Row 1: view toggle + CSV */}
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
              {(['table', 'heatmap'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    view === v ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {v === 'table' ? 'Daily Table' : 'Heatmap'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCsv}
                disabled={!sheets || sheets.length === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ↓ Export CSV
              </button>
            </div>
          </div>

          {/* Row 2: date range + presets */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-slate-500 text-xs">From</label>
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 px-2 py-1.5 focus:outline-none focus:border-blue-600"
              />
              <label className="text-slate-500 text-xs">To</label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                max={todayStr()}
                onChange={e => setEndDate(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 px-2 py-1.5 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="flex gap-1">
              {[7, 30, 90].map(d => (
                <button
                  key={d}
                  onClick={() => applyPreset(d)}
                  className="px-2 py-1 rounded text-xs text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  {d}d
                </button>
              ))}
              <button
                onClick={() => applyPreset(180)}
                className="px-2 py-1 rounded text-xs text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
              >
                6m
              </button>
            </div>
          </div>

          {/* Row 3: tower filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 text-xs">Tower:</span>
            {(['All', ...TOWERS] as const).map(t => (
              <button
                key={t}
                onClick={() => setTowerFilter(t)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                  towerFilter === t
                    ? t === 'All'
                      ? 'bg-slate-700 text-white border-slate-600'
                      : 'border-transparent text-white'
                    : 'border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'
                }`}
                style={
                  towerFilter === t && t !== 'All'
                    ? { background: TOWER_COLORS[t], borderColor: TOWER_COLORS[t] }
                    : undefined
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Status / flag summary */}
        {!loading && flagCounts && sheets && sheets.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>{sheets.length} sheets loaded</span>
            {flagCounts.ok > 0 && (
              <span className="text-emerald-600">✓ {flagCounts.ok} OK</span>
            )}
            {flagCounts.flagged > 0 && (
              <span className="text-amber-500">⚠ {flagCounts.flagged} flagged</span>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-16 text-slate-500 text-sm">Loading…</div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4">
            <p className="text-red-400 text-sm">Failed to load: {error}</p>
          </div>
        )}

        {/* Content */}
        {!loading && !error && sheets && (
          view === 'table'
            ? <DailyTable sheets={sheets} towerFilter={towerFilter} />
            : <HeatmapView sheets={sheets} towerFilter={towerFilter} startDate={startDate} endDate={endDate} />
        )}
      </div>
    </main>
  );
}
