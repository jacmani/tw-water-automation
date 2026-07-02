import { formatLitresFull } from '@/lib/utils';
import { formatMediumDate } from '@/lib/utils';

interface Props {
  inputTotal: number | null;
  towerUsage: number | null;
  diff: number | null;
  sheetDate: string;
}

export default function SummaryRow({ inputTotal, towerUsage, diff, sheetDate }: Props) {
  const diffIsLarge = diff != null && Math.abs(diff) > 2000;

  // Hero band (audit M3) — these are the master governance numbers for the whole
  // complex, previously rendered at the same text-sm weight as secondary details.
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
      <p className="section-label mb-3">
        Community water balance — {formatMediumDate(sheetDate)}
      </p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-slate-500 dark:text-slate-400 text-xs mb-1">Input</p>
          <p className="text-slate-900 dark:text-white font-bold text-2xl leading-tight">{formatLitresFull(inputTotal)}</p>
        </div>
        <div>
          <p className="text-slate-500 dark:text-slate-400 text-xs mb-1">Tower Usage</p>
          <p className="text-slate-900 dark:text-white font-bold text-2xl leading-tight">{formatLitresFull(towerUsage)}</p>
        </div>
        <div>
          <p className="text-slate-500 dark:text-slate-400 text-xs mb-1">Diff</p>
          <p className={`font-bold text-2xl leading-tight ${diffIsLarge ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {diff == null ? '—' : `${diff > 0 ? '+' : ''}${formatLitresFull(diff)}`}
          </p>
          {diffIsLarge && (
            <p className="text-red-500 dark:text-red-400 text-[11px] font-semibold mt-0.5">⚠ above tolerance</p>
          )}
        </div>
      </div>
    </div>
  );
}
