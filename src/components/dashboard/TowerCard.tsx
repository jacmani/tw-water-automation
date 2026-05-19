import type { TowerDashboardData } from '@/types';
import {
  TOWER_COLORS,
  TOWER_TEXT_CLASSES,
  formatLitres,
  isAboveThreshold,
  percentageDiff,
} from '@/lib/utils';

interface Props {
  data: TowerDashboardData;
}

export default function TowerCard({ data }: Props) {
  const { tower, total_today, total_yesterday, seven_day_avg, today_do, today_dr } = data;
  const color = TOWER_COLORS[tower];
  const textClass = TOWER_TEXT_CLASSES[tower];

  const isAlert = isAboveThreshold(total_today, seven_day_avg, 15);
  const diffPct =
    total_today != null && seven_day_avg != null && seven_day_avg > 0
      ? percentageDiff(total_today, seven_day_avg)
      : null;

  const hasData = total_today != null;

  return (
    <div
      className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <div className="p-3.5">
        {/* Tower name */}
        <p className={`text-xs font-semibold uppercase tracking-wider ${textClass}`}>
          {tower}
        </p>

        {/* Main consumption figure */}
        <div className="mt-2 mb-3">
          {hasData ? (
            <p className="text-2xl font-bold text-white leading-none">
              {formatLitres(total_today)}
            </p>
          ) : (
            <p className="text-xl font-bold text-slate-600 leading-none">No data</p>
          )}
          {hasData && (
            <p className="text-slate-400 text-xs mt-0.5">today</p>
          )}
        </div>

        {/* Secondary stats */}
        <div className="space-y-1 text-xs text-slate-400">
          <div className="flex justify-between">
            <span>Yesterday</span>
            <span className="text-slate-300">{formatLitres(total_yesterday)}</span>
          </div>
          <div className="flex justify-between">
            <span>7-day avg</span>
            <span className="text-slate-300">{formatLitres(seven_day_avg)}</span>
          </div>
          {today_do != null && today_dr != null && (
            <div className="flex justify-between pt-1 border-t border-slate-800">
              <span>
                DO&nbsp;
                <span className="text-slate-300">{formatLitres(today_do)}</span>
              </span>
              <span>
                DR&nbsp;
                <span className="text-slate-300">{formatLitres(today_dr)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Alert / diff badge */}
        {diffPct != null && (
          <div
            className={`mt-3 rounded-lg px-2 py-1 text-xs font-medium text-center ${
              isAlert
                ? 'bg-red-950 text-red-400 border border-red-800'
                : diffPct > 0
                ? 'bg-slate-800 text-slate-300'
                : 'bg-slate-800 text-emerald-400'
            }`}
          >
            {isAlert && '⚠ '}
            {diffPct > 0 ? '+' : ''}{diffPct.toFixed(1)}% vs avg
          </div>
        )}
      </div>
    </div>
  );
}
