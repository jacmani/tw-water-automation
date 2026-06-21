'use client';

import { useState } from 'react';
import type { SheetRecord } from './types';
import type { TowerName } from '@/types';
import { TOWER_COLORS } from '@/lib/utils';
import CalendarHeatmap from './CalendarHeatmap';

const TOWERS: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];

function getTowerTotal(s: SheetRecord, tower: TowerName): number | null {
  const rows = s.tower_consumption.filter(r => r.tower === tower);
  const total = rows.reduce((sum, r) => sum + (r.total_ltrs ?? 0), 0);
  return rows.length > 0 ? total : null;
}

interface Props {
  sheets: SheetRecord[];
  towerFilter: TowerName | 'All';
  startDate: string;
  endDate: string;
}

export default function HeatmapView({ sheets, towerFilter, startDate, endDate }: Props) {
  const [mode, setMode] = useState<'community' | 'per-tower'>('community');
  const activeTowers = towerFilter === 'All' ? TOWERS : [towerFilter];

  return (
    <div>
      <div className="flex gap-2 mb-5">
        {(['community', 'per-tower'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === m
                ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}>
            {m === 'community' ? 'Community' : 'Per Tower'}
          </button>
        ))}
      </div>

      {mode === 'community' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-4">
            Community Daily Usage — deviation from period mean
          </p>
          <CalendarHeatmap sheets={sheets} getValue={s => s.summary?.tower_usage ?? null}
            label="" startDate={startDate} endDate={endDate} />
        </div>
      )}

      {mode === 'per-tower' && (
        <div className={`grid gap-5 ${activeTowers.length > 1 ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
          {activeTowers.map(tower => (
            <div key={tower} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <CalendarHeatmap sheets={sheets} getValue={s => getTowerTotal(s, tower)}
                label={tower} startDate={startDate} endDate={endDate} color={TOWER_COLORS[tower]} />
            </div>
          ))}
        </div>
      )}

      <p className="text-slate-400 dark:text-slate-600 text-xs mt-3">
        Hover / tap a cell for exact date, value, and flag. Amber border = flagged day.
      </p>
    </div>
  );
}
