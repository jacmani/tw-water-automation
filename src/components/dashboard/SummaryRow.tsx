import { formatLitresFull } from '@/lib/utils';

interface Props {
  inputTotal: number | null;
  towerUsage: number | null;
  diff: number | null;
}

export default function SummaryRow({ inputTotal, towerUsage, diff }: Props) {
  const diffIsLarge = diff != null && Math.abs(diff) > 2000;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
        Input vs Output — Today
      </p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-slate-400 text-xs mb-1">Input</p>
          <p className="text-white font-semibold text-sm">{formatLitresFull(inputTotal)}</p>
        </div>
        <div>
          <p className="text-slate-400 text-xs mb-1">Tower Usage</p>
          <p className="text-white font-semibold text-sm">{formatLitresFull(towerUsage)}</p>
        </div>
        <div>
          <p className="text-slate-400 text-xs mb-1">Diff</p>
          <p
            className={`font-semibold text-sm ${
              diffIsLarge ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {diff == null ? '—' : `${diff > 0 ? '+' : ''}${formatLitresFull(diff)}`}
            {diffIsLarge && ' ⚠'}
          </p>
        </div>
      </div>
    </div>
  );
}
