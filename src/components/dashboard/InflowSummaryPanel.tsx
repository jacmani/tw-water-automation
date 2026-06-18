import type { DailyInflowSummary } from '@/types';
import { formatLitresFull } from '@/lib/utils';

interface Props {
  data: DailyInflowSummary | null;
  date: string | null;
}

export default function InflowSummaryPanel({ data, date }: Props) {
  if (!data) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
          Inflow / Usage Summary
          {date && <span className="normal-case font-normal ml-1">({date})</span>}
        </p>
        <p className="text-slate-600 text-sm">Log not entered for this date</p>
      </div>
    );
  }

  const isNegativeBalance = data.balance != null && data.balance < 0;

  const items = [
    { label: 'Water Inflow', value: data.water_inflow, color: 'text-blue-400' },
    { label: 'Well Inflow',   value: data.well_inflow,   color: 'text-emerald-400' },
    { label: 'Tanker Inflow', value: data.tanker_inflow, color: 'text-orange-400' },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
        Inflow / Usage Summary
      </p>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {items.map(({ label, value, color }) => (
          <div key={label} className="text-center">
            <p className="text-slate-500 text-xs mb-0.5">{label}</p>
            <p className={`text-sm font-semibold ${color}`}>{formatLitresFull(value)}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-800 pt-3 grid grid-cols-3 gap-2">
        <div className="text-center">
          <p className="text-slate-500 text-xs mb-0.5">Total In</p>
          <p className="text-white font-semibold text-sm">{formatLitresFull(data.total_collection)}</p>
        </div>
        <div className="text-center">
          <p className="text-slate-500 text-xs mb-0.5">Total Out</p>
          <p className="text-white font-semibold text-sm">{formatLitresFull(data.total_usage)}</p>
        </div>
        <div className="text-center">
          <p className="text-slate-500 text-xs mb-0.5">Balance</p>
          <p
            className={`font-semibold text-sm ${
              isNegativeBalance ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {data.balance == null
              ? '—'
              : `${data.balance > 0 ? '+' : ''}${formatLitresFull(data.balance)}`}
            {isNegativeBalance && ' ⚠'}
          </p>
        </div>
      </div>

      {isNegativeBalance && (
        <p className="mt-2 text-red-400/80 text-xs">Negative balance may indicate a leak or measurement error.</p>
      )}
    </div>
  );
}
