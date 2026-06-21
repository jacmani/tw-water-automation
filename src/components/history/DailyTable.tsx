'use client';

import { useState } from 'react';
import type { SheetRecord, HTowerRow, HSourceRow, Flag } from './types';
import type { TowerName } from '@/types';
import { TOWER_COLORS, formatMediumDate } from '@/lib/utils';

const TOWERS: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];
const PAGE_SIZE = 30;

function kl(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return `${(n / 1000).toFixed(decimals)} kL`;
}
function numFmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-IN');
}

function FlagBadge({ flag }: { flag: Flag }) {
  if (flag.type === 'ok') {
    return (
      <span title={flag.detail} className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 cursor-help">
        ✓ OK
      </span>
    );
  }
  return (
    <span title={flag.detail}
      className={`inline-block px-2 py-0.5 rounded text-xs font-semibold cursor-help border ${
        flag.type === 'digit_drop' || flag.type === 'source_duplication'
          ? 'bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-300 border-red-200 dark:border-red-800/60'
          : flag.type === 'summary_misread'
          ? 'bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700'
          : 'bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700/60'
      }`}>
      ⚠ {flag.label}
    </span>
  );
}

function ConfValue({ value, confidence, formatter = numFmt }: {
  value: number | null | undefined;
  confidence: number | null | undefined;
  formatter?: (n: number | null | undefined) => string;
}) {
  const low = confidence != null && confidence < 0.8;
  return (
    <span title={confidence != null ? `Confidence: ${(confidence * 100).toFixed(0)}%` : undefined}
      className={low ? 'italic opacity-50 cursor-help' : ''}>
      {formatter(value)}
      {low && <sup className="ml-0.5 text-amber-500 text-[9px]">⚠</sup>}
    </span>
  );
}

function SourcesSection({ sources }: { sources: HSourceRow[] }) {
  if (!sources.length) return <p className="text-slate-400 dark:text-slate-500 text-xs italic">No source rows extracted.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            <th className="text-left py-1 pr-3 font-semibold">Location</th>
            <th className="text-right py-1 px-2 font-semibold">Yesterday</th>
            <th className="text-right py-1 px-2 font-semibold">Today</th>
            <th className="text-right py-1 pl-2 font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s, i) => (
            <tr key={i} className="border-t border-slate-200 dark:border-slate-800/50">
              <td className="py-1 pr-3 text-slate-700 dark:text-slate-300">{s.location}</td>
              <td className="py-1 px-2 text-right text-slate-500 dark:text-slate-400">{numFmt(s.yesterday_ltrs)}</td>
              <td className="py-1 px-2 text-right text-slate-500 dark:text-slate-400">{numFmt(s.today_ltrs)}</td>
              <td className="py-1 pl-2 text-right text-slate-900 dark:text-slate-200 font-medium">{numFmt(s.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TowerSection({ rows, towerFilter }: { rows: HTowerRow[]; towerFilter: TowerName | 'All' }) {
  if (!rows.length) return <p className="text-slate-400 dark:text-slate-500 text-xs italic">No tower consumption rows extracted.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            <th className="text-left py-1 pr-2 font-semibold">Tower</th>
            <th className="text-left py-1 pr-3 font-semibold">Type</th>
            <th className="text-right py-1 px-2 font-semibold">Total</th>
            <th className="text-right py-1 px-2 font-semibold">Vol Today</th>
            <th className="text-right py-1 pl-2 font-semibold">Diff</th>
          </tr>
        </thead>
        <tbody>
          {TOWERS.flatMap(tower => {
            const towerRows = rows.filter(r => r.tower === tower);
            const highlight = towerFilter !== 'All' && towerFilter !== tower;
            return towerRows.map((r, i) => (
              <tr key={`${tower}-${r.type}-${i}`} className={`border-t border-slate-200 dark:border-slate-800/50 ${highlight ? 'opacity-30' : ''}`}>
                {i === 0 && (
                  <td rowSpan={towerRows.length} className="py-1 pr-2 font-semibold align-middle" style={{ color: TOWER_COLORS[tower] }}>
                    {tower}
                  </td>
                )}
                <td className="py-1 pr-3 text-slate-500 dark:text-slate-400">{r.type}</td>
                <td className="py-1 px-2 text-right text-slate-900 dark:text-slate-200 font-medium">
                  <ConfValue value={r.total_ltrs} confidence={r.confidence} />
                </td>
                <td className="py-1 px-2 text-right text-slate-500 dark:text-slate-400">
                  <ConfValue value={r.vol_today} confidence={r.confidence} />
                </td>
                <td className="py-1 pl-2 text-right text-slate-500 dark:text-slate-400">
                  <ConfValue value={r.diff} confidence={r.confidence} />
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

function TableRow({ sheet, towerFilter }: { sheet: SheetRecord; towerFilter: TowerName | 'All' }) {
  const [open, setOpen] = useState(false);
  const sum = sheet.summary;
  const diffVal = sum?.diff ?? null;
  const diffColor =
    diffVal == null ? 'text-slate-400'
    : Math.abs(diffVal) > 50_000 ? 'text-red-500 dark:text-red-400'
    : Math.abs(diffVal) > 10_000 ? 'text-amber-500 dark:text-amber-400'
    : 'text-slate-500 dark:text-slate-400';

  return (
    <>
      <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}>
        <td className="px-4 py-3 text-slate-800 dark:text-slate-200 text-sm font-medium whitespace-nowrap">{formatMediumDate(sheet.date)}</td>
        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-sm text-right whitespace-nowrap">{kl(sum?.input_total)}</td>
        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-sm text-right whitespace-nowrap">{kl(sum?.tower_usage)}</td>
        <td className={`px-4 py-3 text-sm text-right whitespace-nowrap ${diffColor}`}>
          {diffVal != null ? `${diffVal > 0 ? '+' : ''}${kl(diffVal)}` : '—'}
        </td>
        <td className="px-4 py-3"><FlagBadge flag={sheet.flag} /></td>
        <td className="px-4 py-3 text-slate-400 text-right w-8">
          <span className="inline-block transition-transform duration-150" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-900/60">
          <td colSpan={6} className="px-4 py-4">
            <div className="space-y-5">
              <div>
                <p className="text-slate-400 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">Water Sources</p>
                <SourcesSection sources={sheet.water_sources} />
              </div>
              <div>
                <p className="text-slate-400 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">
                  Tower Consumption
                  {towerFilter !== 'All' && <span className="normal-case text-slate-500 dark:text-slate-600 ml-1">(other towers dimmed)</span>}
                </p>
                <TowerSection rows={sheet.tower_consumption} towerFilter={towerFilter} />
              </div>
              {sheet.flag.type !== 'ok' && (
                <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-700/30 rounded-lg px-3 py-2">
                  <p className="text-amber-700 dark:text-amber-400 text-xs">⚠ {sheet.flag.detail}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

interface Props { sheets: SheetRecord[]; towerFilter: TowerName | 'All' }

export default function DailyTable({ sheets, towerFilter }: Props) {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(sheets.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(1, totalPages));
  const paged = sheets.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (!sheets.length) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center">
        <p className="text-slate-400 dark:text-slate-500 text-sm">No processed sheets found for this date range.</p>
      </div>
    );
  }

  const btnCls = "px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors";

  return (
    <div>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                {['Date','Input Total','Tower Usage','Diff','Flag',''].map((h, i) => (
                  <th key={i} className={`text-slate-500 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider px-4 py-3 ${i > 0 && i < 4 ? 'text-right' : i === 0 ? 'text-left' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map(sheet => <TableRow key={sheet.id} sheet={sheet} towerFilter={towerFilter} />)}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-slate-400 dark:text-slate-500 text-xs">{sheets.length} rows · page {safePage} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(1)} disabled={safePage === 1} className={btnCls}>««</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1} className={btnCls}>‹ Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className={btnCls}>Next ›</button>
            <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages} className={btnCls}>»»</button>
          </div>
        </div>
      )}
    </div>
  );
}
