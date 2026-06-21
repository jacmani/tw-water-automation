'use client';

import { useState, useRef, useEffect } from 'react';
import type { SheetRecord, Flag } from './types';

const CELL = 20;
const GAP = 3;
const STEP = CELL + GAP;
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

interface CalCell {
  date: string;
  value: number | null;
  deviationPct: number | null;
  flag: Flag | null;
  hasSheet: boolean;
}

interface TooltipData {
  cell: CalCell;
  x: number;
  y: number;
}

function buildCalendar(start: string, end: string): (string | null)[][] {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  const dow = (s.getDay() + 6) % 7;
  const gridStart = new Date(s);
  gridStart.setDate(gridStart.getDate() - dow);

  const weeks: (string | null)[][] = [];
  const cur = new Date(gridStart);
  while (cur <= e) {
    const week: (string | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const ds = cur.toISOString().split('T')[0];
      week.push(cur >= s && cur <= e ? ds : null);
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function buildMonthLabels(weeks: (string | null)[][]): { name: string; col: number }[] {
  const seen = new Set<string>();
  const labels: { name: string; col: number }[] = [];
  weeks.forEach((week, col) => {
    week.forEach(date => {
      if (!date) return;
      const d = new Date(date + 'T12:00:00');
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!seen.has(key)) {
        seen.add(key);
        labels.push({ name: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), col });
      }
    });
  });
  return labels;
}

function cellColor(pct: number | null, hasData: boolean): { bg: string; glow: string } {
  if (!hasData) return { bg: '#0A0F1E', glow: 'none' };
  if (pct === null) return { bg: '#1E293B', glow: 'none' };

  if (Math.abs(pct) < 5) {
    return { bg: 'linear-gradient(135deg, #334155 0%, #2D3B4F 100%)', glow: 'none' };
  }
  if (pct < 0) {
    // Blues — below average
    const t = Math.min(-pct / 60, 1);
    const l = Math.round(28 + t * 28);
    const s2 = Math.round(60 + t * 20);
    return {
      bg: `linear-gradient(135deg, hsl(215,${s2}%,${l}%) 0%, hsl(220,${s2}%,${Math.round(l * 0.8)}%) 100%)`,
      glow: t > 0.5 ? `0 0 6px hsl(215,${s2}%,${l}%)50` : 'none',
    };
  }
  // Oranges → Reds — above average
  const t = Math.min(pct / 60, 1);
  const h = Math.round(28 - t * 28);
  const l = Math.round(32 + t * 14);
  return {
    bg: `linear-gradient(135deg, hsl(${h},90%,${l}%) 0%, hsl(${h - 5},90%,${Math.round(l * 0.78)}%) 100%)`,
    glow: t > 0.5 ? `0 0 6px hsl(${h},90%,${l}%)60` : 'none',
  };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function CellTooltip({ data, containerRef }: { data: TooltipData; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: data.x, top: data.y });

  useEffect(() => {
    const tip = tipRef.current;
    const container = containerRef.current;
    if (!tip || !container) return;
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const contRect = container.getBoundingClientRect();
    let left = data.x + 10;
    let top = data.y - tipH / 2;
    if (left + tipW > contRect.width - 8) left = data.x - tipW - 10;
    if (top < 4) top = 4;
    if (top + tipH > contRect.height - 4) top = contRect.height - tipH - 4;
    setPos({ left, top });
  }, [data, containerRef]);

  const { cell } = data;
  const flagColor = cell.flag && cell.flag.type !== 'ok'
    ? { summary_misread: '#EF4444', digit_drop: '#F97316', source_duplication: '#EAB308', unexplained_gap: '#A855F7' }[cell.flag.type] ?? '#F59E0B'
    : null;

  return (
    <div
      ref={tipRef}
      className="absolute z-50 pointer-events-none"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-3 w-52 text-xs">
        {/* Date */}
        <p className="text-white font-semibold mb-2 leading-tight">{formatDate(cell.date)}</p>

        {!cell.hasSheet && (
          <p className="text-slate-500 italic">No sheet uploaded</p>
        )}

        {cell.hasSheet && (
          <>
            {/* Value */}
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-slate-400">Consumption</span>
              <span className="text-white font-bold text-sm">
                {cell.value != null ? `${(cell.value / 1000).toFixed(1)} kL` : '—'}
              </span>
            </div>

            {/* Deviation bar */}
            {cell.deviationPct != null && (
              <div className="mb-2">
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>vs avg</span>
                  <span className={cell.deviationPct > 0 ? 'text-orange-400' : 'text-blue-400'}>
                    {cell.deviationPct > 0 ? '+' : ''}{cell.deviationPct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(Math.abs(cell.deviationPct), 100)}%`,
                      background: cell.deviationPct > 0
                        ? 'linear-gradient(90deg, #F97316, #EF4444)'
                        : 'linear-gradient(90deg, #3B82F6, #06B6D4)',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Flag */}
            {cell.flag && cell.flag.type !== 'ok' && flagColor && (
              <div
                className="flex items-start gap-1.5 rounded-lg px-2 py-1.5 mt-1"
                style={{ background: flagColor + '18', borderLeft: `3px solid ${flagColor}` }}
              >
                <span style={{ color: flagColor }}>⚠</span>
                <span style={{ color: flagColor }} className="leading-snug">{cell.flag.label}</span>
              </div>
            )}
            {cell.flag && cell.flag.type === 'ok' && (
              <div className="flex items-center gap-1.5 text-emerald-400 mt-1">
                <span>✓</span>
                <span>Data looks good</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface Props {
  sheets: SheetRecord[];
  getValue: (s: SheetRecord) => number | null;
  label: string;
  startDate: string;
  endDate: string;
  color?: string;
}

export default function CalendarHeatmap({ sheets, getValue, label, startDate, endDate, color = '#7C3AED' }: Props) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const byDate = new Map(sheets.map(s => [s.date, s]));
  const weeks = buildCalendar(startDate, endDate);
  const monthLabels = buildMonthLabels(weeks);

  const values = sheets.map(s => getValue(s)).filter((v): v is number => v != null);
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  const cells: Map<string, CalCell> = new Map();
  weeks.forEach(week => {
    week.forEach(date => {
      if (!date) return;
      const sheet = byDate.get(date) ?? null;
      const value = sheet ? getValue(sheet) : null;
      const dev = mean && value != null ? ((value - mean) / mean) * 100 : null;
      cells.set(date, { date, value, deviationPct: dev, flag: sheet ? sheet.flag : null, hasSheet: !!sheet });
    });
  });

  const totalWidth = weeks.length * STEP - GAP;

  function handleMouseEnter(e: React.MouseEvent<HTMLDivElement>, cell: CalCell) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cellRect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      cell,
      x: cellRect.left - rect.left + CELL + 6,
      y: cellRect.top - rect.top,
    });
  }

  return (
    <div>
      {label && (
        <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color }}>
          {label}
        </p>
      )}

      <div ref={containerRef} className="relative overflow-x-auto">
        <div style={{ display: 'inline-flex', gap: 10 }}>
          {/* Day labels */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, paddingTop: 24, minWidth: 28 }}>
            {DAY_LABELS.map((d, i) => (
              <div key={i} style={{ height: CELL, fontSize: 10, color: '#475569', lineHeight: `${CELL}px`, textAlign: 'right' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Grid + month labels */}
          <div>
            {/* Month labels */}
            <div style={{ position: 'relative', height: 22, width: totalWidth, marginBottom: 2 }}>
              {monthLabels.map(({ name, col }) => (
                <span
                  key={col}
                  style={{ position: 'absolute', left: col * STEP, fontSize: 10, color: '#64748B', whiteSpace: 'nowrap', fontWeight: 600 }}
                >
                  {name}
                </span>
              ))}
            </div>

            {/* Week columns */}
            <div style={{ display: 'flex', gap: GAP }}>
              {weeks.map((week, wIdx) => (
                <div key={wIdx} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
                  {week.map((date, dIdx) => {
                    if (!date) {
                      return (
                        <div key={dIdx} style={{ width: CELL, height: CELL, borderRadius: 4, background: '#05080F' }} />
                      );
                    }
                    const cell = cells.get(date);
                    const hasSheet = byDate.has(date);
                    const { bg, glow } = cell ? cellColor(cell.deviationPct, hasSheet) : { bg: '#0F172A', glow: 'none' };
                    const isFlagged = cell?.flag && cell.flag.type !== 'ok';

                    return (
                      <div
                        key={dIdx}
                        onMouseEnter={(e) => cell && handleMouseEnter(e, cell)}
                        onMouseLeave={() => setTooltip(null)}
                        style={{
                          width: CELL,
                          height: CELL,
                          borderRadius: 4,
                          background: bg,
                          cursor: hasSheet ? 'pointer' : 'default',
                          boxSizing: 'border-box',
                          border: isFlagged
                            ? '1.5px solid rgba(251,191,36,0.6)'
                            : '1.5px solid transparent',
                          boxShadow: glow !== 'none' ? glow : undefined,
                          transition: 'transform 0.1s ease, box-shadow 0.1s ease',
                        }}
                        onMouseOver={(e) => {
                          if (hasSheet) (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.35)';
                        }}
                        onMouseOut={(e) => {
                          (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)';
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Instant React tooltip — no OS delay */}
        {tooltip && <CellTooltip data={tooltip} containerRef={containerRef} />}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2.5 mt-4 flex-wrap">
        <span className="text-slate-600 text-xs">Below avg</span>
        {[-50, -20, 0, 20, 50].map(pct => {
          const { bg } = cellColor(pct, true);
          return (
            <div
              key={pct}
              style={{ width: CELL, height: CELL, borderRadius: 4, background: bg, flexShrink: 0 }}
            />
          );
        })}
        <span className="text-slate-600 text-xs">Above avg</span>
        <div style={{ width: CELL, height: CELL, borderRadius: 4, background: '#0A0F1E', border: '1px solid #1e293b', flexShrink: 0 }} />
        <span className="text-slate-600 text-xs">No sheet</span>
        {mean != null && (
          <span className="text-slate-500 text-xs ml-auto font-medium">
            Avg: {(mean / 1000).toFixed(0)} kL/day
          </span>
        )}
      </div>
    </div>
  );
}
