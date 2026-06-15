'use client';

import type { SheetRecord, Flag } from './types';

const CELL = 13;
const GAP = 2;
const STEP = CELL + GAP;
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

interface CalCell {
  date: string;
  value: number | null;
  deviationPct: number | null;
  flag: Flag | null;
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
        labels.push({
          name: d.toLocaleDateString('en-IN', { month: 'short' }),
          col,
        });
      }
    });
  });
  return labels;
}

function cellColor(pct: number | null, hasData: boolean): string {
  if (!hasData) return '#0F172A';      // very dark - no sheet
  if (pct === null) return '#1E293B'; // data but no value
  if (Math.abs(pct) < 5) return '#334155'; // within 5% = neutral
  if (pct < 0) {
    const t = Math.min(-pct / 50, 1);
    const l = Math.round(25 + t * 30);
    return `hsl(215,75%,${l}%)`;
  }
  const t = Math.min(pct / 50, 1);
  const h = Math.round(25 - t * 25); // orange → red
  const l = Math.round(28 + t * 18);
  return `hsl(${h},85%,${l}%)`;
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
      cells.set(date, {
        date,
        value,
        deviationPct: dev,
        flag: sheet ? sheet.flag : null,
      });
    });
  });

  const totalWidth = weeks.length * STEP - GAP;

  return (
    <div>
      {label && (
        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color }}>
          {label}
        </p>
      )}
      <div className="overflow-x-auto">
        <div style={{ display: 'inline-flex', gap: 8 }}>
          {/* Day labels */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, paddingTop: 20 }}>
            {DAY_LABELS.map((d, i) => (
              <div key={i} style={{ height: CELL, fontSize: 9, color: '#475569', lineHeight: `${CELL}px`, whiteSpace: 'nowrap' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Grid + month labels */}
          <div>
            {/* Month labels row */}
            <div style={{ position: 'relative', height: 18, width: totalWidth, marginBottom: 2 }}>
              {monthLabels.map(({ name, col }) => (
                <span
                  key={col}
                  style={{
                    position: 'absolute',
                    left: col * STEP,
                    fontSize: 10,
                    color: '#64748B',
                    whiteSpace: 'nowrap',
                  }}
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
                      return <div key={dIdx} style={{ width: CELL, height: CELL, borderRadius: 2, background: '#0A0F1E' }} />;
                    }
                    const cell = cells.get(date);
                    const hasData = byDate.has(date);
                    const bg = cell ? cellColor(cell.deviationPct, hasData) : '#0F172A';
                    const fmt = (v: number) => `${(v / 1000).toFixed(0)} kL`;
                    const title = cell
                      ? `${date}: ${cell.value != null ? fmt(cell.value) : 'no value'}${cell.deviationPct != null ? ` (${cell.deviationPct > 0 ? '+' : ''}${cell.deviationPct.toFixed(0)}% vs avg)` : ''}${cell.flag && cell.flag.type !== 'ok' ? ` — ⚠ ${cell.flag.label}` : ''}`
                      : `${date}: no sheet`;

                    return (
                      <div
                        key={dIdx}
                        title={title}
                        style={{
                          width: CELL,
                          height: CELL,
                          borderRadius: 2,
                          background: bg,
                          cursor: hasData ? 'pointer' : 'default',
                          boxSizing: 'border-box',
                          border: hasData && cell?.flag?.type !== 'ok' && cell?.flag?.type !== undefined
                            ? '1px solid rgba(251,191,36,0.4)'
                            : '1px solid transparent',
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <span className="text-slate-600 text-xs">Less</span>
        {[-50, -25, 0, 25, 50].map(pct => (
          <div
            key={pct}
            title={`${pct > 0 ? '+' : ''}${pct}% vs avg`}
            style={{ width: CELL, height: CELL, borderRadius: 2, background: cellColor(pct, true) }}
          />
        ))}
        <span className="text-slate-600 text-xs">More</span>
        <span className="text-slate-700 text-xs ml-2">Grey = no sheet</span>
        {mean != null && (
          <span className="text-slate-600 text-xs ml-2">
            Avg: {(mean / 1000).toFixed(0)} kL/day
          </span>
        )}
      </div>
    </div>
  );
}
