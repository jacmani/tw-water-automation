import type { WaterLevelReading } from '@/types';

interface Props {
  data: WaterLevelReading | null;
}

// Must match water_level_readings.time_slot CHECK constraint ('6AM'/'12PM'/'6PM'/'12AM'
// — see migration 006_fix_check_constraints.sql).
const SLOT_LABEL: Record<string, string> = {
  '6AM': '6 AM', '12PM': '12 PM', '6PM': '6 PM', '12AM': '12 AM',
};

function LevelBar({ label, pct }: { label: string; pct: number | null }) {
  const value = pct ?? 0;
  const color = value >= 60 ? 'bg-emerald-500' : value >= 30 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-500 dark:text-slate-400">{label}</span>
        <span className="text-slate-700 dark:text-slate-300 font-medium">{pct != null ? `${pct.toFixed(0)}%` : '—'}</span>
      </div>
      <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

export default function WaterLevelsPanel({ data }: Props) {
  if (!data) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Tank Levels</p>
        <p className="text-slate-500 dark:text-slate-400 text-sm">No level readings for this date</p>
      </div>
    );
  }

  const slotLabel = SLOT_LABEL[data.time_slot] ?? data.time_slot;
  const levels = [
    { label: 'Jupiter DO', pct: data.jupiter_do },
    { label: 'Jupiter DR', pct: data.jupiter_dr },
    { label: 'Collection Tank', pct: data.collection_tank },
    { label: 'Mercury DO', pct: data.mercury_do },
    { label: 'Mercury DR', pct: data.mercury_dr },
  ];

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">Tank Levels</p>
        <span className="text-slate-500 dark:text-slate-400 text-xs">{slotLabel} reading</span>
      </div>
      <div className="space-y-2.5">
        {levels.map(({ label, pct }) => (
          <LevelBar key={label} label={label} pct={pct} />
        ))}
      </div>
      {data.cumulative_total != null && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">Cumulative Total</span>
          <span className="text-slate-700 dark:text-slate-300 font-medium">{data.cumulative_total.toLocaleString('en-IN')} kL</span>
        </div>
      )}
    </div>
  );
}
