'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import type { TrendChartPoint, TowerName } from '@/types';
import { TOWER_COLORS, formatShortDate, formatLitres } from '@/lib/utils';

const TOWERS: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];

interface Props { data: TrendChartPoint[] }

function formatYAxis(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

function formatDayName(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short' });
}

function XAxisTick({ x, y, payload, fill }: { x?: number; y?: number; payload?: { value: string; originalDate?: string }; fill: string }) {
  if (!payload) return null;
  const dayName = payload.originalDate ? formatDayName(payload.originalDate) : '';
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={14} textAnchor="middle" fill={fill} fontSize={11}>{payload.value}</text>
      <text x={0} y={0} dy={27} textAnchor="middle" fill={fill} fontSize={10} opacity={0.7}>{dayName}</text>
    </g>
  );
}

function CustomTooltip({ active, payload, label, isDark }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  isDark: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className={`rounded-lg p-3 text-xs shadow-xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
      <p className={`font-medium mb-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>{entry.name}:</span>
          <span className={`font-medium ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {entry.value != null ? formatLitres(entry.value) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TrendChart({ data }: Props) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = !mounted || resolvedTheme === 'dark';
  const gridColor  = isDark ? '#1e293b' : '#e2e8f0';
  const axisColor  = isDark ? '#64748b' : '#94a3b8';
  const legendColor = isDark ? '#94a3b8' : '#64748b';

  const formattedData = data.map((d) => ({
    ...d,
    originalDate: d.date,
    date: formatShortDate(d.date),
  }));

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={formattedData} margin={{ top: 5, right: 10, left: -10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="date"
            tick={(props) => (
              <XAxisTick
                {...props}
                fill={axisColor}
                payload={{ ...props.payload, originalDate: formattedData.find(d => d.date === props.payload?.value)?.originalDate }}
              />
            )}
            axisLine={false}
            tickLine={false}
            height={48}
          />
          <YAxis
            tickFormatter={formatYAxis}
            tick={{ fill: axisColor, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip isDark={isDark} />} />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={(value) => <span style={{ color: legendColor }}>{value}</span>}
          />
          {TOWERS.map((tower) => (
            <Line
              key={tower}
              type="monotone"
              dataKey={tower}
              stroke={TOWER_COLORS[tower]}
              strokeWidth={2}
              dot={{ fill: TOWER_COLORS[tower], r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
