'use client';

// Needs 'use client': it renders <CountUp>, a Client Component that takes a
// `format` function prop. Passing a function prop from a Server Component
// (this file, as imported by the Server-Component dashboard page) into a
// Client Component isn't allowed — functions aren't serializable across the
// RSC boundary — which is exactly what broke the 9267bc0 build ("Functions
// cannot be passed directly to Client Components"). Marking this file
// 'use client' keeps it and CountUp in the same client bundle, so no
// serialization is needed.
import type { TowerDashboardData } from '@/types';
import {
  TOWER_COLORS,
  TOWER_TEXT_CLASSES,
  formatLitres,
  isAboveThreshold,
  percentageDiff,
} from '@/lib/utils';
import Card from '@/components/ui/Card';
import CountUp from '@/components/ui/CountUp';

interface Props {
  data: TowerDashboardData;
}

// 7-point sparkline (audit I1) — replaces "is today's number rising or falling?"
// guesswork from a single static average with an at-a-glance trend line.
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const w = 60;
  const h = 16;
  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const coords = points
    .map((p, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (p - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-shrink-0 overflow-visible" aria-hidden="true">
      <polyline points={coords} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function TowerCard({ data, index = 0 }: Props & { index?: number }) {
  const { tower, total_today, total_yesterday, seven_day_avg, today_do, today_dr, trend } = data;
  const color = TOWER_COLORS[tower];
  const textClass = TOWER_TEXT_CLASSES[tower];
  const sparkPoints = [...trend]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => t.total)
    .filter((n): n is number => n != null)
    .slice(-7);

  const isAlert = isAboveThreshold(total_today, seven_day_avg, 15);
  const diffPct =
    total_today != null && seven_day_avg != null && seven_day_avg > 0
      ? percentageDiff(total_today, seven_day_avg)
      : null;

  const hasData = total_today != null;

  return (
    <Card
      interactive
      accentColor={color}
      className="overflow-hidden animate-[fadeInUp_0.35s_cubic-bezier(0.16,1,0.3,1)_both]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="p-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-xs font-semibold uppercase tracking-wider ${textClass}`}>
            {tower}
          </p>
          <Sparkline points={sparkPoints} color={color} />
        </div>

        <div className="mt-2 mb-3">
          {hasData ? (
            <p className="text-2xl font-bold text-slate-900 dark:text-white leading-none tabular-nums">
              <CountUp value={total_today} format={formatLitres} />
            </p>
          ) : (
            <p className="text-xl font-bold text-slate-300 dark:text-slate-600 leading-none">No data</p>
          )}
          {hasData && (
            <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">Today</p>
          )}
        </div>

        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex justify-between">
            <span>Yesterday</span>
            <span className="text-slate-700 dark:text-slate-300">{formatLitres(total_yesterday)}</span>
          </div>
          <div className="flex justify-between">
            <span>7-day avg</span>
            <span className="text-slate-700 dark:text-slate-300">{formatLitres(seven_day_avg)}</span>
          </div>
          {today_do != null && today_dr != null && (
            <div className="flex justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
              <span>
                DO&nbsp;
                <span className="text-slate-700 dark:text-slate-300">{formatLitres(today_do)}</span>
              </span>
              <span>
                DR&nbsp;
                <span className="text-slate-700 dark:text-slate-300">{formatLitres(today_dr)}</span>
              </span>
            </div>
          )}
        </div>

        {diffPct != null && (
          <div
            className={`mt-3 rounded-lg px-2 py-1 text-xs font-medium text-center transition-colors ${
              isAlert
                ? 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
                : diffPct > 0
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                : 'bg-emerald-50 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {isAlert && '⚠ '}
            {diffPct > 0 ? '+' : ''}{diffPct.toFixed(1)}% vs avg
          </div>
        )}
      </div>
    </Card>
  );
}
