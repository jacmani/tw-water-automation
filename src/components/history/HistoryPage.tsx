'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import { createClient } from '@supabase/supabase-js';
import type { TowerName } from '@/types';
import { TOWER_COLORS } from '@/lib/utils';
import { computeFlag } from './flagging';
import { buildCsv, downloadCsv } from './csvExport';
import type { SheetRecord, HTowerRow, HSourceRow, HSummary } from './types';
import DailyTable from './DailyTable';
import HeatmapView from './HeatmapView';

const TOWERS: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];

function todayStr(): string { return new Date().toISOString().split('T')[0]; }
function daysAgoStr(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().split('T')[0];
}

interface RawTowerRow {
  tower: string; type: string; total_ltrs: number | null;
  r_yesterday: number | null; r_today: number | null;
  vol_yesterday: number | null; vol_today: number | null;
  diff: number | null; confidence: number | null;
}
interface RawSourceRow {
  location: string; source_type: string | null;
  r_yesterday: number | null; r_today: number | null;
  yesterday_ltrs: number | null; today_ltrs: number | null; total: number | null;
}
interface RawSummary {
  input_total: number | null; tower_usage: number | null; diff: number | null;
  v_side: number | null; n_side: number | null; jtr_tanker: number | null; mtr_tanker: number | null;
}
interface RawSheet {
  id: string; date: string; date_source: 'ai' | 'manual' | null; confidence_score: number | null;
  summary: RawSummary[] | RawSummary | null;
  tower_consumption: RawTowerRow[]; water_sources: RawSourceRow[];
}

function normalise(raw: RawSheet): SheetRecord {
  const summaryRaw = Array.isArray(raw.summary) ? raw.summary[0] : raw.summary;
  const summary: HSummary | null = summaryRaw ? {
    input_total: summaryRaw.input_total, tower_usage: summaryRaw.tower_usage,
    diff: summaryRaw.diff, v_side: summaryRaw.v_side, n_side: summaryRaw.n_side,
    jtr_tanker: summaryRaw.jtr_tanker, mtr_tanker: summaryRaw.mtr_tanker,
  } : null;
  const tc: HTowerRow[] = (raw.tower_consumption ?? []).map(r => ({
    tower: r.tower as TowerName, type: r.type as 'DO' | 'DR',
    total_ltrs: r.total_ltrs, r_yesterday: r.r_yesterday, r_today: r.r_today,
    vol_yesterday: r.vol_yesterday, vol_today: r.vol_today, diff: r.diff, confidence: r.confidence,
  }));
  const ws: HSourceRow[] = (raw.water_sources ?? []).map(r => ({
    location: r.location, source_type: r.source_type, r_yesterday: r.r_yesterday,
    r_today: r.r_today, yesterday_ltrs: r.yesterday_ltrs, today_ltrs: r.today_ltrs, total: r.total,
  }));
  return { id: raw.id, date: raw.date, date_source: raw.date_source ?? null, confidence_score: raw.confidence_score, summary, tower_consumption: tc, water_sources: ws, flag: computeFlag(summary, tc, ws) };
}

export default function HistoryPage() {
  const [view, setView] = useState<'table' | 'heatmap'>('table');
  const [towerFilter, setTowerFilter] = useState<TowerName | 'All'>('All');
  const [startDate, setStartDate] = useState(daysAgoStr(30));
  const [endDate, setEndDate] = useState(todayStr());
  const [sheets, setSheets] = useState<SheetRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  const fetchData = useCallback(async (start: string, end: string) => {
    setLoading(true); setError(null);
    const { data, error: err } = await supabase
      .from('daily_sheets')
      .select(`id, date, date_source, confidence_score,
        summary ( input_total, tower_usage, diff, v_side, n_side, jtr_tanker, mtr_tanker ),
        tower_consumption ( tower, type, total_ltrs, r_yesterday, r_today, vol_yesterday, vol_today, diff, confidence ),
        water_sources ( location, source_type, r_yesterday, r_today, yesterday_ltrs, today_ltrs, total )`)
      .eq('superseded', false).eq('processed_status', 'processed')
      .gte('date', start).lte('date', end).order('date', { ascending: false });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setSheets((data as unknown as RawSheet[]).map(normalise));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(startDate, endDate); }, [startDate, endDate, fetchData]);

  function applyPreset(days: number) { setStartDate(daysAgoStr(days)); setEndDate(todayStr()); }
  function handleCsv() {
    if (!sheets) return;
    downloadCsv(buildCsv(sheets, towerFilter), startDate, endDate);
  }

  const flagCounts = sheets ? {
    ok: sheets.filter(s => s.flag.type === 'ok').length,
    flagged: sheets.filter(s => s.flag.type !== 'ok').length,
  } : null;

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-1">
        <h1 className="text-base font-semibold text-slate-700 dark:text-slate-300">Consumption History</h1>
        <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">Full extraction record with cross-checks</p>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-5">
        {/* Controls */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              {(['table', 'heatmap'] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    view === v ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}>
                  {v === 'table' ? 'Daily Table' : 'Heatmap'}
                </button>
              ))}
            </div>
            <button onClick={handleCsv} disabled={!sheets || sheets.length === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              ↓ Export CSV
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-slate-400 dark:text-slate-500 text-xs">From</label>
              <input type="date" value={startDate} max={endDate} onChange={e => setStartDate(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-200 px-2 py-1.5 focus:outline-none focus:border-blue-500 dark:focus:border-blue-600" />
              <label className="text-slate-400 dark:text-slate-500 text-xs">To</label>
              <input type="date" value={endDate} min={startDate} max={todayStr()} onChange={e => setEndDate(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-200 px-2 py-1.5 focus:outline-none focus:border-blue-500 dark:focus:border-blue-600" />
            </div>
            <div className="flex gap-1">
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => applyPreset(d)}
                  className="px-2 py-1 rounded text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  {d}d
                </button>
              ))}
              <button onClick={() => applyPreset(180)}
                className="px-2 py-1 rounded text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                6m
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 dark:text-slate-500 text-xs">Tower:</span>
            {(['All', ...TOWERS] as const).map(t => (
              <button key={t} onClick={() => setTowerFilter(t)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                  towerFilter === t
                    ? t === 'All' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white border-slate-300 dark:border-slate-600'
                      : 'border-transparent text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-500'
                }`}
                style={towerFilter === t && t !== 'All' ? { background: TOWER_COLORS[t], borderColor: TOWER_COLORS[t] } : undefined}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {!loading && flagCounts && sheets && sheets.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
            <span>{sheets.length} sheets loaded</span>
            {flagCounts.ok > 0 && <span className="text-emerald-600 dark:text-emerald-500">✓ {flagCounts.ok} OK</span>}
            {flagCounts.flagged > 0 && <span className="text-amber-500">⚠ {flagCounts.flagged} flagged</span>}
          </div>
        )}

        {loading && <div className="text-center py-16 text-slate-400 dark:text-slate-500 text-sm">Loading…</div>}

        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-4">
            <p className="text-red-600 dark:text-red-400 text-sm">Failed to load: {error}</p>
          </div>
        )}

        {!loading && !error && sheets && (
          view === 'table'
            ? <DailyTable sheets={sheets} towerFilter={towerFilter} />
            : <HeatmapView sheets={sheets} towerFilter={towerFilter} startDate={startDate} endDate={endDate} />
        )}
      </div>
    </main>
  );
}
